import Foundation
import LocalAuthentication

/// The signed-in owner's password, kept only in this phone's Keychain (never sent anywhere, never in league data).
/// The server stores a one-way hash, so this device copy is the only way to show it again.
nonisolated enum PasswordVault {
    private static let key = "account.password"
    private static let ownerKey = "account.password.owner"

    static func save(_ password: String, userId: String?) {
        guard !password.isEmpty, let userId else { return }
        KeychainStore.set(password, for: key)
        KeychainStore.set(userId, for: ownerKey)
    }

    static func clear() {
        KeychainStore.set(nil, for: key)
        KeychainStore.set(nil, for: ownerKey)
    }

    /// True when this phone has a saved password for this account.
    static func hasPassword(for userId: String?) -> Bool {
        guard let userId, KeychainStore.get(ownerKey) == userId else { return false }
        return KeychainStore.get(key) != nil
    }

    /// Asks for Face ID / Touch ID / passcode, then returns the saved password for this account.
    static func reveal(for userId: String?) async -> Result<String, VaultError> {
        guard let userId, KeychainStore.get(ownerKey) == userId, let pw = KeychainStore.get(key) else { return .failure(.notSaved) }
        let context = LAContext()
        context.localizedCancelTitle = "Cancel"
        var authError: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &authError) else { return .failure(.unavailable) }
        do {
            let ok = try await context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: "Show your Fantasy T&F password")
            return ok ? .success(pw) : .failure(.cancelled)
        } catch {
            return .failure(.cancelled)
        }
    }

    enum VaultError: Error {
        case notSaved, unavailable, cancelled

        var message: String {
            switch self {
            case .notSaved: return "This phone doesn't have your password saved yet. Sign in again on this phone, or change your password below."
            case .unavailable: return "Set a passcode on this phone to reveal your password."
            case .cancelled: return "Verification cancelled."
            }
        }
    }
}
