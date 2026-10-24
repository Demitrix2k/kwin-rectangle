let windowProperties = {};

function screenSize() {
    let workarea = workspace.clientArea(
        KWin.PlacementArea,
        workspace.activeWindow,
    )
    const ms = margins();
    workarea.x += ms.left;
    workarea.y += ms.top;
    workarea.width -= ms.left + ms.right;
    workarea.height -= ms.top + ms.bottom;
    return workarea;
}

function restoreOnUnsnap() {
    return readConfig('ResizeOnUnsnap', true)
}

function paddings() {
    return {
        inner: readConfig('InnerPadding', 8),
        outer: readConfig('OuterPadding', 8),
    }
}

function resizeStep() {
    return readConfig('ResizeStep', 80)
}

function margins() {
    return {
        left: readConfig('MarginLeft', 0),
        top: readConfig('MarginTop', 0),
        right: readConfig('MarginRight', 0),
        bottom: readConfig('MarginBottom', 0),
    }
}

function geometryForGrid(index, rowSpan, colSpan, rows, cols) {
    if (index >= rows * cols || index < 0) {
        return workspace.activeWindow.frameGeometry
    }

    const screen = screenSize()
    const pad = paddings()

    const availW = screen.width - (cols - 1) * pad.inner - 2 * pad.outer
    const availH = screen.height - (rows - 1) * pad.inner - 2 * pad.outer
    const singleWinW = availW / cols
    const singleWinH = availH / rows
    const winW = colSpan * singleWinW + (colSpan - 1) * pad.inner
    const winH = rowSpan * singleWinH + (rowSpan - 1) * pad.inner

    const winJ = index % cols
    const winI = (index - winJ) / cols
    const winX = screen.x + pad.outer + winJ * (singleWinW + pad.inner)
    const winY = screen.y + pad.outer + winI * (singleWinH + pad.inner)

    return {
        width: Math.round(winW),
        height: Math.round(winH),
        x: Math.round(winX),
        y: Math.round(winY),
    }
}

function center(geometry) {
    const screen = screenSize()
    return {
        width: geometry.width,
        height: geometry.height,
        x: screen.x + Math.round((screen.width - geometry.width) / 2),
        y: screen.y + Math.round((screen.height - geometry.height) / 2),
    }
}

/*
 * - rs and cs are row and col span, how many cells in the grid will be
 * taken by the window.
 * - r and c are the size of the grid.
 * - Index is the zero-index of the square in the grid.
 * For example, if index=2, rs=1, cs=1, r=2, c=2, then
 * you get the first column and second row:
 * |--0--|--1--|
 * |##2##|--3--|
 * If index=2, rs=1, cs=2, r=2, c=2, then
 * you get the first column and second row and will occupy two cells:
 * |--0--|--1--|
 * |##2##|##3##|
 * Negative indexes have special meanings:
 * -1: Just center the window
 * -2: Resize and center
 * -3: Maximize window's width
 * -4: Maximize window's height
 * -5: Move window in rs,cs direction
 * -6: Stretch (resizes to make window touch screen side)
 * -7: Increases window span (rs and cs)
 * -10: Fill: take the largest free area not covered by other windows
 * -11: Grow (rs=1) or shrink (rs=-1) by ResizeStep like a tiler: edges shared
 *       with a neighbouring window move together, so the neighbour gives or
 *       takes the space. cs picks the axis: 0 both, 1 width only, 2 height only
 */
function manage(index, rs, cs, r, c) {
    const client = workspace.activeWindow
    if (!client) {
        return
    }

    // Do not modify the geometry of a desktop window. It probably needs to
    // be fullscreen to display desktop wallpaper and icons.
    if (client.desktopWindow) {
        return;
    }

    // KWin 6.0 changed the way that change signals work, so we need to grab a copy
    // of the geometry and save it after snapping rather than before like we used to.
    const prevGeometry = {
        width: client.frameGeometry.width,
        height: client.frameGeometry.height,
    }

    // The object that comes from workspace.activeWindow.frameGeometry is weird and
    // won't update the size in many cases. It's better to create a new one so
    // KWin can detect the changes properly
    let geometry = {
        width: client.frameGeometry.width,
        height: client.frameGeometry.height,
        x: client.frameGeometry.x,
        y: client.frameGeometry.y,
    }

    let rectangleArgs = windowProperties?.[client.internalId]?.args
    let now = Date.now()

    if (index >= 0
        && rectangleArgs != null
        && rectangleArgs[0] == index
        && rectangleArgs[1] == rs
        && rectangleArgs[2] == cs
        && rectangleArgs[3] == r
        && rectangleArgs[4] == c
        && Math.abs(now - rectangleArgs[5]) < 1000) {
        index = (rectangleArgs[0] + 1) % (r * c)
    }

    if (index >= 0) {
        geometry = geometryForGrid(index, rs, cs, r, c)
    } else if (index == -1) {
        geometry = center(geometry)
    } else if (index == -2) {
        geometry = geometryForGrid(1, rs, cs, r, c)
        geometry = center(geometry)
        rectangleArgs = [0, rs, cs, r, c, now]
    } else if (index == -3) {
        const full = geometryForGrid(0, 1, 1, 1, 1)
        geometry.x = full.x
        geometry.width = full.width
    } else if (index == -4) {
        const full = geometryForGrid(0, 1, 1, 1, 1)
        geometry.y = full.y
        geometry.height = full.height
    } else if (index == -5 && rectangleArgs != null) {
        let idx, prs, pcs, pr, pc
        ;[idx, prs, pcs, pr, pc, _] = rectangleArgs
        let j = idx % pc
        let i = (idx - j) / pc
        j = Math.min(pc - pcs, Math.max(0, j + rs))
        i = Math.min(pr - prs, Math.max(0, i + cs))
        idx = i * pc + j
        geometry = geometryForGrid(idx, prs, pcs, pr, pc)
        rectangleArgs = [idx, prs, pcs, pr, pc, now]
    } else if (index == -6) {
        const screen = screenSize()
        const pad = paddings()
        switch (rs) {
            case 0:
                geometry.height += geometry.y - pad.outer
                geometry.y = pad.outer
                break
            case 1:
                geometry.height = screen.height - pad.outer - geometry.y
                break
            case 2:
                geometry.width += geometry.x - pad.outer
                geometry.x = pad.outer
                break
            case 3:
                geometry.width = screen.width - pad.outer - geometry.x
                break
        }
    } else if (index == -7 && rectangleArgs != null) {
        let idx, prs, pcs, pr, pc
        ;[idx, prs, pcs, pr, pc, _] = rectangleArgs
        let j = idx % pc
        let i = (idx - j) / pc
        let newj = Math.min(pc - pcs, Math.max(0, j + rs))
        let newi = Math.min(pr - prs, Math.max(0, i + cs))
        // Adds colum/row if necessary
        pcs += j != newj ? 1 : 0
        prs += i != newi ? 1 : 0
        // Moves only if newi/newj is smaller (only towards top-left)
        newj = j < newj ? j : newj
        newi = i < newi ? i : newi
        idx = newi * pc + newj
        geometry = geometryForGrid(idx, prs, pcs, pr, pc)
        rectangleArgs = [idx, prs, pcs, pr, pc, now]
    } else if (index == -10) {
        geometry = fillGeometry(client) || geometry
    } else if (index == -11) {
        geometry = resizedWithNeighbours(client, rs * resizeStep(), cs) || geometry
    }

    if (index >= 0) {
        rectangleArgs = [index, rs, cs, r, c, now]
    }

    // Disconnect the geometry-change handler before touching frameGeometry so
    // restoreGeometry cannot fire between setMaximize/frameGeometry and
    // saveGeometry (which would see a stale snapped_geometry and incorrectly
    // restore the window to a previous direction).
    const existingProps = windowProperties?.[client.internalId]
    if (existingProps?.geometryHandler) {
        client.frameGeometryChanged.disconnect(existingProps.geometryHandler)
        delete existingProps.geometryHandler
    }

    client.setMaximize(false, false)
    client.frameGeometry = geometry

    saveGeometry(client, geometry, prevGeometry, rectangleArgs)

    // Free-form resizes leave the grid state stale, so Stretch Step and Move
    // must not continue from an old cell.
    if (index == -10 || index == -11) {
        delete windowProperties[client.internalId].args
    }
}

// Other windows on the same output and desktop that the window must not cover.
function otherWindows(client) {
    const desktop = typeof workspace.currentDesktopForScreen === 'function'
        ? workspace.currentDesktopForScreen(client.output)
        : workspace.currentDesktop
    return workspace.windowList().filter(w =>
        w !== client
        && w.normalWindow
        && !w.minimized
        && !w.desktopWindow
        && w.output === client.output
        && (w.onAllDesktops || w.desktops.indexOf(desktop) >= 0)
    )
}

// Grows or shrinks the window by delta pixels on every side, tiler style.
// A side that has a neighbouring window moves the shared edge, so the
// neighbour shrinks (grow) or expands (shrink) by the same amount. A side that
// sits on the screen edge stays put, and a side facing free space moves on its
// own until the screen edge or the next window. Moves the neighbours itself and
// returns the geometry for the window.
function resizedWithNeighbours(client, delta, axis) {
    const area = screenSize()
    const pad = paddings()
    const g = client.frameGeometry
    // Same fraction of the screen on both axes, so windows don't get lopsided
    // on 16:9 and other non-square monitors. ResizeStep is the long axis.
    const long = Math.max(area.width, area.height)
    const stepX = Math.abs(delta) * area.width / long
    const stepY = Math.abs(delta) * area.height / long
    const grow = delta > 0
    const slack = 4
    const near = pad.inner + 12
    const minW = 200
    const minH = 150
    const others = otherWindows(client)

    const gx2 = g.x + g.width
    const gy2 = g.y + g.height
    const overlapsY = n => n.y < gy2 && n.y + n.height > g.y
    const overlapsX = n => n.x < gx2 && n.x + n.width > g.x

    const sides = {
        right: { gap: n => n.x - gx2, span: overlapsY, size: n => n.width, min: minW,
                 room: area.x + area.width - pad.outer - gx2 },
        left: { gap: n => g.x - (n.x + n.width), span: overlapsY, size: n => n.width, min: minW,
                room: g.x - (area.x + pad.outer) },
        bottom: { gap: n => n.y - gy2, span: overlapsX, size: n => n.height, min: minH,
                  room: area.y + area.height - pad.outer - gy2 },
        top: { gap: n => g.y - (n.y + n.height), span: overlapsX, size: n => n.height, min: minH,
               room: g.y - (area.y + pad.outer) },
    }

    // outward movement of each of our edges, and the neighbours that follow
    const move = {}
    const follow = {}
    for (const name in sides) {
        const sd = sides[name]
        const horizontal = name == 'left' || name == 'right'
        if ((axis == 1 && !horizontal) || (axis == 2 && horizontal)) {
            move[name] = 0
            follow[name] = []
            continue
        }
        const step = horizontal ? stepX : stepY
        const geos = others.map(w => ({ w, f: w.frameGeometry })).filter(o => sd.span(o.f))
        const nb = geos.filter(o => sd.gap(o.f) >= -slack && sd.gap(o.f) <= near)
        follow[name] = nb.map(o => o.w)

        if (nb.length > 0) {
            move[name] = grow
                ? Math.min(step, ...nb.map(o => sd.size(o.f) - sd.min))
                : -step
        } else if (sd.room <= slack) {
            move[name] = 0
        } else if (grow) {
            const free = geos.map(o => sd.gap(o.f)).filter(d => d > near).map(d => d - pad.inner)
            move[name] = Math.min(step, sd.room, ...free)
        } else {
            move[name] = -step
        }
        if (grow && move[name] < 0) {
            move[name] = 0
        }
    }

    // Shrinking a window that is pinned on both sides of an axis (maximized)
    // would otherwise do nothing, so shrink it from both sides instead.
    if (!grow) {
        if (axis != 2 && move.left == 0 && move.right == 0) {
            move.left = move.right = -stepX
        }
        if (axis != 1 && move.top == 0 && move.bottom == 0) {
            move.top = move.bottom = -stepY
        }
    }

    // keep a minimum size on each axis
    if (g.width + move.left + move.right < minW) {
        move.left = move.right = 0
    }
    if (g.height + move.top + move.bottom < minH) {
        move.top = move.bottom = 0
    }

    const moveNeighbour = (w, x, y, width, height) => {
        const props = windowProperties[w.internalId]
        const geo = { x, y, width, height }
        // keep Rectangle's unsnap-restore from undoing this resize
        if (props && props.snapped) {
            props.snapped_geometry = geo
        }
        w.frameGeometry = geo
    }
    for (const w of follow.right) {
        const f = w.frameGeometry
        moveNeighbour(w, f.x + move.right, f.y, f.width - move.right, f.height)
    }
    for (const w of follow.left) {
        const f = w.frameGeometry
        moveNeighbour(w, f.x, f.y, f.width - move.left, f.height)
    }
    for (const w of follow.bottom) {
        const f = w.frameGeometry
        moveNeighbour(w, f.x, f.y + move.bottom, f.width, f.height - move.bottom)
    }
    for (const w of follow.top) {
        const f = w.frameGeometry
        moveNeighbour(w, f.x, f.y, f.width, f.height - move.top)
    }

    return {
        x: Math.round(g.x - move.left),
        y: Math.round(g.y - move.top),
        width: Math.round(g.width + move.left + move.right),
        height: Math.round(g.height + move.top + move.bottom),
    }
}

// Largest rectangle inside the work area that overlaps no other window and
// keeps the inner padding to them, or null if nothing free is left.
function fillGeometry(client) {
    const area = screenSize()
    const pad = paddings()
    const left = area.x + pad.outer
    const top = area.y + pad.outer
    const right = area.x + area.width - pad.outer
    const bottom = area.y + area.height - pad.outer

    const boxes = otherWindows(client).map(w => w.frameGeometry).map(g => ({
        x1: g.x - pad.inner,
        y1: g.y - pad.inner,
        x2: g.x + g.width + pad.inner,
        y2: g.y + g.height + pad.inner,
    })).filter(b => b.x2 > left && b.x1 < right && b.y2 > top && b.y1 < bottom)

    // The best rectangle's edges always lie on the work area or on an
    // obstacle edge, so only those coordinates are candidates.
    const xs = [left, right]
    const ys = [top, bottom]
    for (const b of boxes) {
        xs.push(b.x1, b.x2)
        ys.push(b.y1, b.y2)
    }
    const uniq = (a, lo, hi) => [...new Set(a.filter(v => v >= lo && v <= hi))].sort((p, q) => p - q)
    const cx = uniq(xs, left, right)
    const cy = uniq(ys, top, bottom)

    let best = null
    let bestArea = 0
    for (let i = 0; i < cx.length; i++) {
        for (let j = i + 1; j < cx.length; j++) {
            for (let k = 0; k < cy.length; k++) {
                for (let l = k + 1; l < cy.length; l++) {
                    const w = cx[j] - cx[i]
                    const h = cy[l] - cy[k]
                    if (w * h <= bestArea) {
                        continue
                    }
                    const hit = boxes.some(b =>
                        b.x1 < cx[j] && b.x2 > cx[i] && b.y1 < cy[l] && b.y2 > cy[k])
                    if (!hit) {
                        bestArea = w * h
                        best = { x: cx[i], y: cy[k], width: w, height: h }
                    }
                }
            }
        }
    }
    return best
}

function saveGeometry(client, newGeometry, prevGeometry, rectangleArgs) {
    if (typeof windowProperties[client.internalId] !== 'object') {
        windowProperties[client.internalId] = {}
    }

    const props = windowProperties[client.internalId]

    if (rectangleArgs) {
        props.args = rectangleArgs
    }

    if (restoreOnUnsnap()) {
        if (!props.geometryHandler) {
            props.geometryHandler = (geo) => restoreGeometry(client, geo)
            client.frameGeometryChanged.connect(props.geometryHandler)
        }

        if (!props.snapped) {
            props.prev_geometry = prevGeometry
        }

        props.snapped_geometry = newGeometry
        props.snapped = true
    } else {
        if (props.geometryHandler) {
            client.frameGeometryChanged.disconnect(props.geometryHandler)
            delete props.geometryHandler
        }

        delete props.prev_geometry
        delete props.snapped
        delete props.snapped_geometry
    }
}

function restoreGeometry(client, geo) {
    if (!restoreOnUnsnap()) {
        return
    }

    const props = windowProperties[client.internalId]
    if (!props || !props.snapped || !props.prev_geometry || !props.snapped_geometry) {
        if (props?.geometryHandler) {
            client.frameGeometryChanged.disconnect(props.geometryHandler)
            delete props.geometryHandler
        }
        return
    }

    // the frameGeometryChanged signal is not fired immediately after the frameGeometry is set
    if (props.prev_geometry.width == geo.width && props.prev_geometry.height == geo.height) {
        return
    }

    // we don't want to delete the properties if the window is resnapped
    if (
        props.snapped_geometry.width == client.frameGeometry.width &&
        props.snapped_geometry.height == client.frameGeometry.height &&
        props.snapped_geometry.x == client.frameGeometry.x &&
        props.snapped_geometry.y == client.frameGeometry.y
    ) {
        return
    }

    if (geo.width == client.frameGeometry.width && geo.height == client.frameGeometry.height) {
        const geometry = {
            width: props.prev_geometry.width,
            height: props.prev_geometry.height,
            x: client.frameGeometry.x,
            y: client.frameGeometry.y,
        }

        client.setMaximize(false, false)
        client.frameGeometry = geometry
    }

    delete windowProperties[client.internalId]

    if (props.geometryHandler) {
        client.frameGeometryChanged.disconnect(props.geometryHandler)
    }
}

function shortcut(text, shortcut, i, rs, cs, r, c) {
    text = 'Rectangle: ' + text
    shortcut = shortcut ? 'Ctrl+Meta+' + shortcut : ''
    registerShortcut(text, text, shortcut, () => manage(i, rs, cs, r, c))
}

shortcut('Quarter: (1) Top Left', 'U', 0, 1, 1, 2, 2)
shortcut('Quarter: (2) Top Right', 'I', 1, 1, 1, 2, 2)
shortcut('Quarter: (3) Bottom Left', 'J', 2, 1, 1, 2, 2)
shortcut('Quarter: (4) Bottom Right', 'K', 3, 1, 1, 2, 2)
shortcut('Quarter: (5) Centered', 'Alt+C', -2, 1, 1, 2, 2)

shortcut('Fourth: (1) First', 'V', 0, 1, 1, 1, 4)
shortcut('Fourth: (2) Second', 'B', 1, 1, 1, 1, 4)
shortcut('Fourth: (3) Third', 'N', 2, 1, 1, 1, 4)
shortcut('Fourth: (4) Fourth', 'M', 3, 1, 1, 1, 4)

shortcut('Three Fourths: (1) Left', 'Shift+N', 0, 1, 3, 1, 4)
shortcut('Three Fourths: (2) Right', 'Shift+M', 1, 1, 3, 1, 4)

shortcut('Third: (1) First', 'D', 0, 1, 1, 1, 3)
shortcut('Third: (2) Second', 'F', 1, 1, 1, 1, 3)
shortcut('Third: (3) Third', 'G', 2, 1, 1, 1, 3)

shortcut('Sixth: (1) Top Left', 'Shift+U', 0, 1, 1, 2, 3)
shortcut('Sixth: (2) Top Center', 'Shift+I', 1, 1, 1, 2, 3)
shortcut('Sixth: (3) Top Right', 'Shift+O', 2, 1, 1, 2, 3)
shortcut('Sixth: (4) Bottom Left', 'Shift+J', 3, 1, 1, 2, 3)
shortcut('Sixth: (5) Bottom Center', 'Shift+K', 4, 1, 1, 2, 3)
shortcut('Sixth: (6) Bottom Right', 'Shift+L', 5, 1, 1, 2, 3)

shortcut('Ninth: (1) Top Left', 'Alt+U', 0, 1, 1, 3, 3)
shortcut('Ninth: (2) Top Center', 'Alt+I', 1, 1, 1, 3, 3)
shortcut('Ninth: (3) Top Right', 'Alt+O', 2, 1, 1, 3, 3)
shortcut('Ninth: (4) Middle Left', 'Alt+J', 3, 1, 1, 3, 3)
shortcut('Ninth: (5) Middle Center', 'Alt+K', 4, 1, 1, 3, 3)
shortcut('Ninth: (6) Middle Right', 'Alt+L', 5, 1, 1, 3, 3)
shortcut('Ninth: (7) Bottom Left', 'Alt+N', 6, 1, 1, 3, 3)
shortcut('Ninth: (8) Bottom Center', 'Alt+M', 7, 1, 1, 3, 3)
shortcut('Ninth: (9) Bottom Right', 'Alt+,', 8, 1, 1, 3, 3)

shortcut('Half: (1) Center (Vertical)', 'Shift+C', -2, 1, 1, 1, 2)
shortcut('Half: (1) Center (Horizontal)', 'Shift+V', -2, 1, 1, 2, 1)
shortcut('Half: (2) Left', 'Left', 0, 1, 1, 1, 2)
shortcut('Half: (2) Right', 'Right', 1, 1, 1, 1, 2)
shortcut('Half: (3) Top', 'Up', 0, 1, 1, 2, 1)
shortcut('Half: (3) Bottom', 'Down', 1, 1, 1, 2, 1)

shortcut('Two Thirds: (1) Left', 'E', 0, 1, 2, 1, 3)
shortcut('Two Thirds: (2) Center', 'R', -2, 1, 2, 1, 3)
shortcut('Two Thirds: (3) Right', 'T', 1, 1, 2, 1, 3)

shortcut('Center', 'C', -1, 1, 1, 1, 1)
shortcut('Maximize', 'Return', 0, 1, 1, 1, 1)
shortcut('Maximize: Almost', 'Shift+Return', 33, 30, 30, 32, 32)
shortcut('Maximize: Height', 'Shift+Alt+Up', -4, 0, 0, 0, 0)
shortcut('Maximize: Width', 'Shift+Alt+Right', -3, 0, 0, 0, 0)

shortcut('Stretch: (1) Top', 'Alt+Up', -6, 0, 0, 0, 0)
shortcut('Stretch: (1) Bottom', 'Alt+Down', -6, 1, 0, 0, 0)
shortcut('Stretch: (2) Left', 'Alt+Left', -6, 2, 0, 0, 0)
shortcut('Stretch: (2) Right', 'Alt+Right', -6, 3, 0, 0, 0)
shortcut('Stretch: Step: (1) Bottom Left', '1', -7, -1, 1, 1, 1)
shortcut('Stretch: Step: (2) Bottom', '2', -7, 0, 1, 1, 1)
shortcut('Stretch: Step: (3) Bottom Right', '3', -7, 1, 1, 1, 1)
shortcut('Stretch: Step: (4) Left', '4', -7, -1, 0, 1, 1)
shortcut('Stretch: Step: (5) Right', '6', -7, 1, 0, 1, 1)
shortcut('Stretch: Step: (6) Top Left', '7', -7, -1, -1, 1, 1)
shortcut('Stretch: Step: (7) Top', '8', -7, 0, -1, 1, 1)
shortcut('Stretch: Step: (8) Top Right', '9', -7, 1, -1, 1, 1)

shortcut('Resize: Grow', '', -11, 1, 0, 0, 0)
shortcut('Resize: Shrink', '', -11, -1, 0, 0, 0)
shortcut('Resize: Grow Width', '', -11, 1, 1, 0, 0)
shortcut('Resize: Shrink Width', '', -11, -1, 1, 0, 0)
shortcut('Resize: Grow Height', '', -11, 1, 2, 0, 0)
shortcut('Resize: Shrink Height', '', -11, -1, 2, 0, 0)
shortcut('Resize: Fill', '', -10, 0, 0, 0, 0)

shortcut('Move: (1) Bottom Left', 'Alt+1', -5, -1, 1, 1, 1)
shortcut('Move: (2) Bottom', 'Alt+2', -5, 0, 1, 1, 1)
shortcut('Move: (3) Bottom Right', 'Alt+3', -5, 1, 1, 1, 1)
shortcut('Move: (4) Left', 'Alt+4', -5, -1, 0, 1, 1)
shortcut('Move: (5) Right', 'Alt+6', -5, 1, 0, 1, 1)
shortcut('Move: (6) Top Left', 'Alt+7', -5, -1, -1, 1, 1)
shortcut('Move: (7) Top', 'Alt+8', -5, 0, -1, 1, 1)
shortcut('Move: (8) Top Right', 'Alt+9', -5, 1, -1, 1, 1)
