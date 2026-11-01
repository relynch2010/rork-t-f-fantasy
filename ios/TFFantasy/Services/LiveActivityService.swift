import ActivityKit
import Foundation

/// Starts/updates/ends matchup Live Activities and forwards their push tokens to OneSignal.
final class LiveActivityService {
    static let shared = LiveActivityService()

    private var tokenTasks: [String: Task<Void, Never>] = [:]

    var isEnabled: Bool { ActivityAuthorizationInfo().areActivitiesEnabled }

    func activity(_ id: String) -> Activity<MatchupAttributes>? {
        Activity<MatchupAttributes>.activities.first { $0.attributes.activityId == id }
    }

    func isRunning(_ id: String) -> Bool {
        guard let activity = activity(id) else { return false }
        return activity.activityState == .active || activity.activityState == .stale
    }

    func start(attributes: MatchupAttributes, content: MatchupAttributes.ContentState) throws {
        if isRunning(attributes.activityId) { return }
        let activity = try Activity.request(
            attributes: attributes,
            content: ActivityContent(state: content, staleDate: nil),
            pushType: .token
        )
        observeTokens(activity)
    }

    /// Re-attach token observers for activities that survived an app relaunch.
    func resumeObservers() {
        for activity in Activity<MatchupAttributes>.activities where tokenTasks[activity.attributes.activityId] == nil {
            observeTokens(activity)
        }
    }

    private func observeTokens(_ activity: Activity<MatchupAttributes>) {
        let id = activity.attributes.activityId
        tokenTasks[id]?.cancel()
        tokenTasks[id] = Task {
            for await data in activity.pushTokenUpdates {
                let token = data.map { String(format: "%02x", $0) }.joined()
                PushService.shared.enterLiveActivity(id: id, token: token)
            }
        }
    }

    func update(_ id: String, content: MatchupAttributes.ContentState) async {
        guard let activity = activity(id), activity.content.state != content else { return }
        await activity.update(ActivityContent(state: content, staleDate: nil))
    }

    func end(_ id: String, content: MatchupAttributes.ContentState?, immediately: Bool) async {
        guard let activity = activity(id) else { return }
        let final = content.map { ActivityContent(state: $0, staleDate: nil) }
        await activity.end(final, dismissalPolicy: immediately ? .immediate : .after(Date().addingTimeInterval(4 * 3600)))
        tokenTasks[id]?.cancel()
        tokenTasks[id] = nil
        PushService.shared.exitLiveActivity(id: id)
    }

    /// Ends activities for this league that don't match the current week.
    func endStale(leagueId: String, keeping id: String?) async {
        for activity in Activity<MatchupAttributes>.activities where activity.attributes.leagueId == leagueId && activity.attributes.activityId != id {
            await end(activity.attributes.activityId, content: nil, immediately: false)
        }
    }
}
