// 只监听电源通知，不监控键盘、鼠标、窗口或输入内容。
import AppKit
import Foundation

func emit(_ kind: String, reason: String? = nil) {
    var message: [String: Any] = ["kind": kind, "ts": Int(Date().timeIntervalSince1970)]
    if let reason { message["reason"] = reason }
    guard let data = try? JSONSerialization.data(withJSONObject: message) else { return }
    FileHandle.standardOutput.write(data + Data([10]))
}

let center = NSWorkspace.shared.notificationCenter
let notifications: [(Notification.Name, String, String?)] = [
    (NSWorkspace.didWakeNotification, "wake", "workspace"),
    (NSWorkspace.willSleepNotification, "sleep", "workspace"),
    (NSWorkspace.screensDidWakeNotification, "display_on", nil),
    (NSWorkspace.screensDidSleepNotification, "display_off", nil),
    (NSWorkspace.willPowerOffNotification, "sleep", "software")
]
var observers: [NSObjectProtocol] = []
for (name, kind, reason) in notifications {
    observers.append(center.addObserver(forName: name, object: nil, queue: nil) { _ in emit(kind, reason: reason) })
}
emit("ready")
RunLoop.main.run()
