import Foundation

/// One OneSignal push subscription for the signed-in account, as OneSignal reports it.
nonisolated struct PushSubscriptionInfo: Codable, Hashable, Identifiable, Sendable {
    let id: String
    let type: String
    let tokenTail: String
    let hasToken: Bool
    let enabled: Bool
    let notificationTypes: Int
    let state: String
    let stateText: String
    let subscribed: Bool
    let environment: String
    let sdk: String
    let appVersion: String
    let deviceModel: String
    let deviceOs: String
}

nonisolated struct PushOsUser: Codable, Hashable, Sendable {
    let found: Bool
    let onesignalId: String?
    let subscriptions: [PushSubscriptionInfo]
    let error: String?
}

nonisolated struct PushAppConfig: Codable, Hashable, Sendable {
    let readable: Bool
    let apnsEnv: String?
    let bundleId: String?
    let teamId: String?
    let keyId: String?
    let hasP8: Bool?
    let bundleMatches: Bool?
    let note: String?
}

nonisolated struct PushStatusBody: Codable, Sendable {
    let configured: Bool
    let keyValid: Bool?
    let bundleId: String?
    let app: PushAppConfig?
    let user: PushOsUser?
    let thisDevice: PushSubscriptionInfo?
    let problem: String?
}

nonisolated struct PushTestStep: Codable, Hashable, Sendable {
    let step: String
    let ok: Bool
    let detail: String
}

nonisolated struct PushDeliveryStats: Codable, Hashable, Sendable {
    let successful: Int
    let failed: Int
    let errored: Int
    let received: Int?
    let remaining: Int
}

nonisolated struct PushTestResult: Codable, Sendable {
    let ok: Bool
    let status: String
    let steps: [PushTestStep]
    let notificationId: String?
    let stats: PushDeliveryStats?
    let error: String?
    let reason: String?
    let at: Double
}
