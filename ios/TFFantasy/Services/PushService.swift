import Foundation
import UIKit
import UserNotifications
import OneSignalFramework
import OneSignalCore
import OneSignalOSCore
import OneSignalUser
import OneSignalNotifications

/// What this phone knows about its own push registration (shown in Push Diagnostics and sent to the backend).
nonisolated struct LocalPushState: Sendable, Equatable {
    var permission: String
    var subscriptionId: String?
    var onesignalId: String?
    var externalId: String?
    var token: String?
    var optedIn: Bool
    var initialized: Bool

    var tokenTail: String { token.map { "…" + String($0.suffix(8)) } ?? "" }
}

/// Central OneSignal wrapper: initialization, identity, permission, subscription changes, taps, Live Activity tokens.
final class PushService: NSObject {
    static let shared = PushService()

    private static let appIdKey = "td.onesignal.appId"
    private(set) var isInitialized: Bool = false
    private var pendingExternalId: String?

    /// Called when the user taps a push: league id plus where inside the league to go.
    var onOpenLink: ((String?, NoteLink?) -> Void)?

    /// Called whenever the APNs token, OneSignal subscription or permission changes, so the store re-registers the device.
    var onRegistrationChange: (() -> Void)?

    /// A tap that arrived before the app finished launching (cold start); delivered once a handler is set.
    private var pendingTap: (String?, NoteLink?)?

    var cachedAppId: String { UserDefaults.standard.string(forKey: Self.appIdKey) ?? "" }

    /// APNs environment this binary was signed for. TestFlight/App Store builds are Release → production APNs.
    static var apnsEnvironment: String {
        #if DEBUG
        return "development"
        #else
        return "production"
        #endif
    }

    func configure(appId: String) {
        let trimmed = appId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        UserDefaults.standard.set(trimmed, forKey: Self.appIdKey)
        guard !isInitialized else { return }
        #if DEBUG
        OneSignal.Debug.setLogLevel(.LL_WARN)
        #endif
        OneSignal.initialize(trimmed, withLaunchOptions: nil)
        OneSignal.Notifications.addClickListener(self)
        OneSignal.Notifications.addPermissionObserver(self)
        OneSignal.User.pushSubscription.addObserver(self)
        isInitialized = true
        if let pendingExternalId {
            OneSignal.login(pendingExternalId)
        }
        // Re-register with APNs on every launch so a rotated/refreshed token always reaches OneSignal.
        UIApplication.shared.registerForRemoteNotifications()
        Task { @MainActor in
            await self.optInIfAllowed()
            self.onRegistrationChange?()
        }
    }

    func login(externalId: String) {
        let changed = pendingExternalId != externalId
        pendingExternalId = externalId
        guard isInitialized else { return }
        if changed || OneSignal.User.externalId != externalId {
            OneSignal.login(externalId)
        }
        Task { @MainActor in
            await self.optInIfAllowed()
            self.onRegistrationChange?()
        }
    }

    /// Stops pushes for the signed-out account on this phone.
    func logout() {
        pendingExternalId = nil
        guard isInitialized else { return }
        OneSignal.logout()
    }

    /// If iOS already allows notifications, make sure the OneSignal subscription is opted in and has a token.
    func optInIfAllowed() async {
        guard isInitialized else { return }
        let status = await permissionStatus()
        guard status == .authorized || status == .provisional || status == .ephemeral else { return }
        if !OneSignal.User.pushSubscription.optedIn { OneSignal.User.pushSubscription.optIn() }
        UIApplication.shared.registerForRemoteNotifications()
    }

    func deliverTap(leagueId: String?, link: NoteLink?) {
        if let onOpenLink {
            onOpenLink(leagueId, link)
        } else {
            pendingTap = (leagueId, link)
        }
    }

    /// Replays a cold-start tap after the store has registered its handler.
    func flushPendingTap() {
        guard let tap = pendingTap, let onOpenLink else { return }
        pendingTap = nil
        onOpenLink(tap.0, tap.1)
    }

    func requestPermission() async -> Bool {
        let accepted: Bool
        if isInitialized {
            accepted = await withCheckedContinuation { continuation in
                OneSignal.Notifications.requestPermission({ accepted in
                    continuation.resume(returning: accepted)
                }, fallbackToSettings: true)
            }
            if accepted { await optInIfAllowed() }
        } else {
            accepted = (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound])) ?? false
            if accepted { UIApplication.shared.registerForRemoteNotifications() }
        }
        onRegistrationChange?()
        return accepted
    }

    func permissionStatus() async -> UNAuthorizationStatus {
        await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
    }

    /// Snapshot of this phone's registration, straight from iOS and the OneSignal SDK.
    func localState() async -> LocalPushState {
        let status = await permissionStatus()
        let permission: String
        switch status {
        case .authorized: permission = "allowed"
        case .denied: permission = "denied"
        case .notDetermined: permission = "not asked"
        case .provisional: permission = "provisional"
        case .ephemeral: permission = "ephemeral"
        @unknown default: permission = "unknown"
        }
        guard isInitialized else {
            return LocalPushState(permission: permission, subscriptionId: nil, onesignalId: nil, externalId: nil, token: nil, optedIn: false, initialized: false)
        }
        let sub = OneSignal.User.pushSubscription
        return LocalPushState(
            permission: permission, subscriptionId: sub.id, onesignalId: OneSignal.User.onesignalId,
            externalId: OneSignal.User.externalId, token: sub.token, optedIn: sub.optedIn, initialized: true
        )
    }

    func enterLiveActivity(id: String, token: String) {
        guard isInitialized else { return }
        OneSignal.LiveActivities.enter(id, withToken: token)
    }

    func exitLiveActivity(id: String) {
        guard isInitialized else { return }
        OneSignal.LiveActivities.exit(id)
    }
}

extension PushService: OSNotificationClickListener {
    nonisolated func onClick(event: OSNotificationClickEvent) {
        let data = event.notification.additionalData ?? [:]
        let leagueId = data["leagueId"] as? String
        let type = data["link"] as? String
        let linkId = data["linkId"] as? String
        let week = (data["week"] as? Int) ?? (data["week"] as? NSNumber)?.intValue
        Task { @MainActor in
            let link = type.map { NoteLink(type: $0, id: linkId, week: week) }
            PushService.shared.deliverTap(leagueId: leagueId, link: link)
        }
    }
}

extension PushService: OSPushSubscriptionObserver {
    nonisolated func onPushSubscriptionDidChange(state: OSPushSubscriptionChangedState) {
        Task { @MainActor in PushService.shared.onRegistrationChange?() }
    }
}

extension PushService: OSNotificationPermissionObserver {
    nonisolated func onNotificationPermissionDidChange(_ permission: Bool) {
        Task { @MainActor in
            if permission { await PushService.shared.optInIfAllowed() }
            PushService.shared.onRegistrationChange?()
        }
    }
}
