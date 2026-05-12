// pick-folder — opens a native macOS folder-picker (NSOpenPanel) and prints
// the selected POSIX path to stdout, or nothing on cancel. Same dialog
// GitHub Desktop opens via Electron's dialog.showOpenDialog, just compiled
// as a tiny standalone CLI so the dashboard server can spawn it without
// AppleScript or osascript overhead.

import Cocoa

let app = NSApplication.shared
app.setActivationPolicy(.regular)
app.activate(ignoringOtherApps: true)

// Let the activation propagate before runModal() takes the main thread.
// Without this, recent macOS focus rules can race the window server and
// leave the panel z-ordered below the calling app's frontmost window.
RunLoop.main.run(until: Date(timeIntervalSinceNow: 0.05))

let panel = NSOpenPanel()
panel.canChooseFiles = false
panel.canChooseDirectories = true
panel.allowsMultipleSelection = false
panel.canCreateDirectories = true
panel.message = "Select project folder"
panel.prompt = "Select"
// .modalPanel level (~8) sits above normal application windows, so the
// dialog surfaces even when Chrome is fullscreen or on a different Space.
panel.level = .modalPanel
panel.makeKeyAndOrderFront(nil)

// Multi-monitor: NSOpenPanel defaults to the menu-bar screen, which is not
// necessarily the one the user is looking at. The mouse just moved to click
// the dashboard button, so its current screen is the best proxy for "where
// the user is." Center the panel there.
let mouseLoc = NSEvent.mouseLocation
let targetScreen = NSScreen.screens.first(where: { NSMouseInRect(mouseLoc, $0.frame, false) })
    ?? NSScreen.main
    ?? NSScreen.screens.first
if let screen = targetScreen {
    let visible = screen.visibleFrame
    let panelSize = panel.frame.size
    let origin = NSPoint(
        x: visible.midX - panelSize.width / 2,
        y: visible.midY - panelSize.height / 2
    )
    panel.setFrameOrigin(origin)
}

if panel.runModal() == .OK, let url = panel.urls.first {
    print(url.path)
}
