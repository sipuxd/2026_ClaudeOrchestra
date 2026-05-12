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

if panel.runModal() == .OK, let url = panel.urls.first {
    print(url.path)
}
