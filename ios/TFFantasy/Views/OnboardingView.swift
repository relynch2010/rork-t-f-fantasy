import SwiftUI

enum AuthMode: Hashable {
    case signIn, signUp, reset
}

/// Email + password accounts. The same account works on every phone.
struct OnboardingView: View {
    @Environment(AppStore.self) private var store
    @State private var mode: AuthMode = .signUp
    @State private var name: String = ""
    @State private var email: String = ""
    @State private var password: String = ""
    @State private var code: String = ""
    @State private var codeSent: Bool = false
    @State private var sentByEmail: Bool = false
    @State private var drawn: Bool = false
    @State private var askPush: Bool = false
    @FocusState private var focus: AuthField?

    enum AuthField: Hashable { case name, email, password, code }

    private var cleanEmail: String { email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
    private var emailValid: Bool { cleanEmail.contains("@") && cleanEmail.split(separator: "@").last?.contains(".") == true }

    private var canSubmit: Bool {
        switch mode {
        case .signIn: return emailValid && !password.isEmpty
        case .signUp: return emailValid && password.count >= 8 && !name.trimmingCharacters(in: .whitespaces).isEmpty
        case .reset: return codeSent ? (code.count == 6 && password.count >= 8) : emailValid
        }
    }

    var body: some View {
        ZStack {
            TrackBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    LaneMark(drawn: drawn)
                        .frame(height: 150)
                        .padding(.top, 16)
                        .padding(.bottom, 28)

                    Text("FANTASY T&F")
                        .font(.system(size: 13, weight: .heavy))
                        .tracking(4)
                        .foregroundStyle(Theme.green)
                        .padding(.bottom, 10)

                    Text(title)
                        .font(Theme.display(44))
                        .lineSpacing(-4)
                        .contentTransition(.opacity)
                        .padding(.bottom, 10)

                    Text(subtitle)
                        .font(.body)
                        .foregroundStyle(Theme.muted)
                        .padding(.bottom, 24)

                    if mode != .reset { modePicker.padding(.bottom, 16) }
                    fields
                    PrimaryButton(title: buttonTitle, systemImage: "arrow.right", isLoading: store.isBusy) { submit() }
                        .opacity(canSubmit ? 1 : 0.45)
                        .disabled(!canSubmit)
                        .padding(.top, 18)

                    footer.padding(.top, 14)
                }
                .padding(.horizontal, 24)
                .padding(.bottom, 24)
            }
            .scrollDismissesKeyboard(.interactively)
        }
        .onAppear { withAnimation(.easeOut(duration: 1.4)) { drawn = true } }
        .animation(.smooth, value: mode)
        .animation(.smooth, value: codeSent)
    }

    private var title: String {
        switch mode {
        case .signUp: return "Draft the team.\nWin the meet."
        case .signIn: return "Welcome\nback."
        case .reset: return codeSent ? "Check your\ncode." : "Reset your\npassword."
        }
    }

    private var subtitle: String {
        switch mode {
        case .signUp: return "Create your account. Your leagues, team and notifications follow you to every phone."
        case .signIn: return "Sign in with the email you used to create your account."
        case .reset:
            if !codeSent { return "We'll send a 6-digit code to reset your password." }
            return sentByEmail ? "Enter the 6-digit code we emailed to \(cleanEmail)." : "Enter the 6-digit code sent as a notification to your phones signed into this account."
        }
    }

    private var buttonTitle: String {
        switch mode {
        case .signUp: return "Create Account"
        case .signIn: return "Sign In"
        case .reset: return codeSent ? "Set New Password" : "Send Code"
        }
    }

    private var modePicker: some View {
        HStack(spacing: 0) {
            ForEach([AuthMode.signUp, .signIn], id: \.self) { m in
                Button {
                    Haptics.tap()
                    mode = m
                } label: {
                    Text(m == .signUp ? "Create account" : "Sign in")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(mode == m ? .black : .white)
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .background(mode == m ? Theme.green : .clear, in: .capsule)
                        .contentShape(.capsule)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(4)
        .background(Theme.surface, in: .capsule)
        .overlay(Capsule().strokeBorder(Theme.line))
    }

    @ViewBuilder
    private var fields: some View {
        VStack(spacing: 12) {
            if mode == .signUp {
                field("Your name", text: $name, field: .name, content: .name)
            }
            if !(mode == .reset && codeSent) {
                field("Email", text: $email, field: .email, content: .emailAddress, keyboard: .emailAddress)
            }
            if mode == .reset && codeSent {
                field("6-digit code", text: $code, field: .code, content: .oneTimeCode, keyboard: .numberPad)
                    .onChange(of: code) { _, v in
                        let digits = String(v.filter(\.isNumber).prefix(6))
                        if digits != v { code = digits }
                    }
            }
            if mode != .reset || codeSent {
                SecureField("", text: $password, prompt: Text(mode == .signIn ? "Password" : "Password (8+ characters)").foregroundStyle(Theme.faint))
                    .textContentType(mode == .signIn ? .password : .newPassword)
                    .focused($focus, equals: .password)
                    .submitLabel(.go)
                    .onSubmit(submit)
                    .modifier(AuthFieldStyle(isFocused: focus == .password))
            }
        }
    }

    private func field(_ prompt: String, text: Binding<String>, field: AuthField, content: UITextContentType, keyboard: UIKeyboardType = .default) -> some View {
        TextField("", text: text, prompt: Text(prompt).foregroundStyle(Theme.faint))
            .textContentType(content)
            .keyboardType(keyboard)
            .textInputAutocapitalization(field == .name ? .words : .never)
            .autocorrectionDisabled(field != .name)
            .focused($focus, equals: field)
            .submitLabel(.next)
            .modifier(AuthFieldStyle(isFocused: focus == field))
    }

    @ViewBuilder
    private var footer: some View {
        VStack(spacing: 4) {
            if mode == .signIn {
                Button("Forgot password?") {
                    Haptics.tap()
                    password = ""
                    codeSent = false
                    mode = .reset
                }
            }
            if mode == .reset {
                if codeSent {
                    Button("Send a new code") { codeSent = false; code = "" }
                }
                Button("Back to sign in") {
                    codeSent = false
                    code = ""
                    password = ""
                    mode = .signIn
                }
            }
        }
        .font(.subheadline.weight(.semibold))
        .foregroundStyle(Theme.muted)
        .frame(maxWidth: .infinity, minHeight: 44)
    }

    private func submit() {
        guard canSubmit, !store.isBusy else { return }
        focus = nil
        Task {
            switch mode {
            case .signUp:
                if await store.signUp(email: cleanEmail, password: password, name: name.trimmingCharacters(in: .whitespaces)) {
                    _ = await PushService.shared.requestPermission()
                }
            case .signIn:
                _ = await store.signIn(email: cleanEmail, password: password)
            case .reset:
                if codeSent {
                    _ = await store.confirmReset(email: cleanEmail, code: code, password: password)
                } else if let r = await store.requestReset(email: cleanEmail) {
                    sentByEmail = r.email ?? false
                    codeSent = true
                    password = ""
                    Haptics.success()
                }
            }
        }
    }
}

private struct AuthFieldStyle: ViewModifier {
    let isFocused: Bool

    func body(content: Content) -> some View {
        content
            .font(.title3.weight(.semibold))
            .padding(.horizontal, 20)
            .frame(height: 58)
            .background(Theme.surface, in: .rect(cornerRadius: 18))
            .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(isFocused ? Theme.green : Theme.line, lineWidth: isFocused ? 1.5 : 1))
    }
}

/// Animated sweeping running-track lanes used as the brand mark.
struct LaneMark: View {
    let drawn: Bool

    var body: some View {
        GeometryReader { geo in
            ZStack {
                ForEach(0..<4, id: \.self) { lane in
                    LaneCurve(offset: CGFloat(lane) * 22)
                        .trim(from: 0, to: drawn ? 1 : 0)
                        .stroke(
                            lane == 0 ? AnyShapeStyle(LinearGradient(colors: [Theme.green, Theme.greenBright], startPoint: .leading, endPoint: .trailing)) : AnyShapeStyle(Color.white.opacity(0.18 - Double(lane) * 0.03)),
                            style: StrokeStyle(lineWidth: lane == 0 ? 7 : 2, lineCap: .round)
                        )
                        .animation(.easeOut(duration: 1.2).delay(Double(lane) * 0.12), value: drawn)
                }
                Image(systemName: "star.fill")
                    .font(.system(size: 22))
                    .foregroundStyle(Theme.gold)
                    .shadow(color: Theme.gold.opacity(0.8), radius: 12)
                    .position(x: geo.size.width - 6, y: 8)
                    .scaleEffect(drawn ? 1 : 0.2)
                    .opacity(drawn ? 1 : 0)
                    .animation(.spring(response: 0.5, dampingFraction: 0.55).delay(1.1), value: drawn)
            }
            .shadow(color: Theme.green.opacity(0.35), radius: 18)
        }
    }
}

struct LaneCurve: Shape {
    var offset: CGFloat

    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: 0, y: rect.maxY - offset * 0.2))
        path.addQuadCurve(
            to: CGPoint(x: rect.maxX - 6, y: 8 + offset),
            control: CGPoint(x: rect.maxX * 0.72 - offset, y: rect.maxY - offset * 0.6)
        )
        return path
    }
}
