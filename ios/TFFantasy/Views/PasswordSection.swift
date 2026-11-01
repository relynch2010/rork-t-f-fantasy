import SwiftUI

/// Account password. The server only keeps a one-way hash, so the reveal comes from this phone's Keychain,
/// behind Face ID / passcode. Visible only to the signed-in owner.
struct PasswordSection: View {
    @Environment(AppStore.self) private var store
    @State private var revealed: String?
    @State private var message: String?
    @State private var showChange: Bool = false

    var body: some View {
        Section {
            HStack {
                Text("Password")
                Spacer()
                Text(revealed ?? "••••••••••")
                    .font(.system(.body, design: .monospaced))
                    .foregroundStyle(revealed == nil ? Theme.muted : .white)
                    .textSelection(.enabled)
                    .contentTransition(.opacity)
            }
            .listRowBackground(Theme.surface)
            Button {
                Task { await toggle() }
            } label: {
                Label(revealed == nil ? "Show Password" : "Hide Password", systemImage: revealed == nil ? "eye" : "eye.slash")
            }
            .listRowBackground(Theme.surface)
            Button {
                showChange = true
            } label: {
                Label("Change Password", systemImage: "key.fill")
            }
            .listRowBackground(Theme.surface)
        } header: {
            Text("Password")
        } footer: {
            Text(message ?? "Only you can see this. Your password is saved securely on this phone after you sign in, and shown only after Face ID or your passcode.")
        }
        .onDisappear { revealed = nil }
        .sheet(isPresented: $showChange) { ChangePasswordSheet() }
    }

    private func toggle() async {
        if revealed != nil {
            withAnimation { revealed = nil }
            return
        }
        switch await PasswordVault.reveal(for: store.user?.id) {
        case .success(let pw):
            withAnimation { revealed = pw }
            message = nil
        case .failure(let e):
            message = e.message
        }
    }
}

struct ChangePasswordSheet: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var current: String = ""
    @State private var next: String = ""
    @State private var confirm: String = ""

    private var problem: String? {
        if next.isEmpty { return nil }
        if next.count < 8 { return "Use at least 8 characters." }
        if !confirm.isEmpty && confirm != next { return "Passwords don't match." }
        return nil
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    SecureField("Current password", text: $current).textContentType(.password)
                    SecureField("New password", text: $next).textContentType(.newPassword)
                    SecureField("Confirm new password", text: $confirm).textContentType(.newPassword)
                } footer: {
                    Text(problem ?? "Changing your password signs out your other devices and the website.")
                        .foregroundStyle(problem == nil ? Theme.muted : Theme.red)
                }
                .listRowBackground(Theme.surface)
            }
            .scrollContentBackground(.hidden)
            .background(Theme.bg)
            .navigationTitle("Change Password")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        Task { if await store.changePassword(current: current, new: next) { dismiss() } }
                    }
                    .disabled(current.isEmpty || next.count < 8 || next != confirm || store.isBusy)
                }
            }
        }
        .presentationDetents([.medium, .large])
    }
}
