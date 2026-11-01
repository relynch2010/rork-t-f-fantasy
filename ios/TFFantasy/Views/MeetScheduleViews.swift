import SwiftUI

/// Commissioner actions on a league-scheduled meet. Each one is logged on the meet and in the audit log.
enum MeetLifecycleAction: String, Identifiable {
    case postpone, reschedule, cancel, interrupt, resume, forceFinal, reopen

    var id: String { rawValue }

    var title: String {
        switch self {
        case .postpone: return "Postpone Meet"
        case .reschedule: return "Reschedule Meet"
        case .cancel: return "Cancel Meet"
        case .interrupt: return "Interrupt Meet"
        case .resume: return "Resume Meet"
        case .forceFinal: return "Finalize Anyway"
        case .reopen: return "Correct Final Results"
        }
    }

    var explainer: String {
        switch self {
        case .postpone: return "Rosters unlock and the matchup stays the same. Reschedule when you have the new date."
        case .reschedule: return "Pick the new start and end. The matchup stays the same, and rosters lock at the new start."
        case .cancel: return "The meet won't happen. Its matchup closes with the points it has now. You can reschedule later if plans change."
        case .interrupt: return "For weather or other delays. Rosters stay locked and scores are kept. Resume when competition restarts."
        case .resume: return "Competition restarted. Live scoring picks up where it stopped."
        case .forceFinal: return "Results still look incomplete. Finalizing locks this matchup's points. This is recorded in the audit log."
        case .reopen: return "Reopens the final results so you can fix a mistake. The change is recorded in the audit log. Mark Final again when done."
        }
    }

    var reasonRequired: Bool { self == .forceFinal || self == .reopen }
    var destructive: Bool { self == .cancel || self == .forceFinal }

    var success: String {
        switch self {
        case .postpone: return "Meet postponed"
        case .reschedule: return "Meet rescheduled"
        case .cancel: return "Meet canceled"
        case .interrupt: return "Meet interrupted"
        case .resume: return "Meet resumed"
        case .forceFinal: return "Meet is final"
        case .reopen: return "Final results reopened for correction"
        }
    }

    static func kindLabel(_ kind: String) -> String {
        switch kind {
        case "schedule": return "Scheduled"
        case "postpone": return "Postponed"
        case "reschedule": return "Rescheduled"
        case "cancel": return "Canceled"
        case "interrupt": return "Interrupted"
        case "resume": return "Resumed"
        case "pending": return "Pending finalization"
        case "final": return "Final"
        case "forced", "final-forced": return "Finalized anyway"
        case "correction": return "Correction opened"
        case "incomplete": return "Results look incomplete"
        default: return kind.capitalized
        }
    }
}

enum MeetTime {
    /// Common US meet time zones, plus the phone's own zone.
    static var zones: [String] {
        var list = ["America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu"]
        let here = TimeZone.current.identifier
        if !list.contains(here) { list.insert(here, at: 0) }
        return list
    }

    static func label(_ id: String) -> String {
        let tz = TimeZone(identifier: id)
        let name = tz?.localizedName(for: .generic, locale: .current) ?? id
        return name
    }

    /// The wall-clock time a picker shows, written as "YYYY-MM-DDTHH:mm" in the meet's zone.
    /// DatePicker works in the phone's zone, so the picked components are re-read as local wall time.
    static func local(_ date: Date) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = .current
        f.dateFormat = "yyyy-MM-dd'T'HH:mm"
        return f.string(from: date)
    }

    /// Inverse of `local`: shows a saved wall time in the picker as the same clock reading.
    static func date(_ local: String?) -> Date? {
        guard let local else { return nil }
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = .current
        f.dateFormat = "yyyy-MM-dd'T'HH:mm"
        return f.date(from: local)
    }
}

/// Start/end/time zone pickers shared by the editor and the reschedule sheet.
struct MeetTimeFields: View {
    @Binding var start: Date
    @Binding var end: Date
    @Binding var timeZone: String

    var body: some View {
        DatePicker("Starts", selection: $start, displayedComponents: [.date, .hourAndMinute])
        DatePicker("Ends", selection: $end, in: start..., displayedComponents: [.date, .hourAndMinute])
        Picker("Time zone", selection: $timeZone) {
            ForEach(MeetTime.zones, id: \.self) { Text(MeetTime.label($0)).tag($0) }
        }
    }
}

struct MeetLifecycleSheet: View {
    let meet: Meet
    let action: MeetLifecycleAction
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var reason: String = ""
    @State private var start: Date = .now
    @State private var end: Date = .now.addingTimeInterval(4 * 3600)
    @State private var timeZone: String = TimeZone.current.identifier
    @State private var sending: Bool = false

    private var trimmed: String { reason.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var canSend: Bool { !sending && (!action.reasonRequired || !trimmed.isEmpty) }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text(meet.name).font(.headline)
                    Text(action.explainer).font(.subheadline).foregroundStyle(Theme.muted)
                }
                if action == .reschedule {
                    Section("New Time") { MeetTimeFields(start: $start, end: $end, timeZone: $timeZone) }
                }
                Section {
                    TextField(action.reasonRequired ? "Reason (required)" : "Reason (optional)", text: $reason, axis: .vertical)
                        .lineLimit(1...4)
                } footer: {
                    Text("Shown in the meet's change log and the league audit log.")
                }
                Section {
                    Button(role: action.destructive ? .destructive : nil) { send() } label: {
                        HStack {
                            Text(action.title).font(.system(size: 16, weight: .heavy))
                            Spacer()
                            if sending { ProgressView() }
                        }
                    }
                    .disabled(!canSend)
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.bg)
            .navigationTitle(action.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } }
            }
            .onAppear {
                timeZone = meet.timeZone ?? TimeZone.current.identifier
                if let s = MeetTime.date(meet.startLocal) { start = s.addingTimeInterval(7 * 86_400) }
                if let e = MeetTime.date(meet.endLocal) { end = e.addingTimeInterval(7 * 86_400) } else { end = start.addingTimeInterval(4 * 3600) }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func send() {
        guard canSend else { return }
        sending = true
        var body: [String: Any]
        switch action {
        case .forceFinal:
            body = ["type": "markFinal", "meetId": meet.id, "force": true, "reason": trimmed]
        case .reopen:
            body = ["type": "reopenMeet", "meetId": meet.id, "reason": trimmed]
        default:
            body = ["type": "meetLifecycle", "meetId": meet.id, "op": action.rawValue, "reason": trimmed]
            if action == .reschedule {
                body["startLocal"] = MeetTime.local(start)
                body["endLocal"] = MeetTime.local(max(end, start))
                body["timeZone"] = timeZone
            }
        }
        Haptics.tap()
        Task {
            let ok = await store.perform(body, success: action.success)
            sending = false
            if ok { dismiss() }
        }
    }
}
