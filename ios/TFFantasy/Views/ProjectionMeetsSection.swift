import SwiftUI

/// Commissioner tool: the meets projections learn from. Paste an AthleticLIVE link or results text, preview what the
/// server matched, then add. Projections only: these meets never score points or set PBs/SBs. Every change is
/// confirmed by the server; success is only shown from its reply.
struct ProjectionMeetsSection: View {
    @Environment(AppStore.self) private var store
    let isGlobal: Bool

    @State private var body_: ProjMeetsBody?
    @State private var source: Source = .link
    @State private var link: String = ""
    @State private var text: String = ""
    @State private var name: String = ""
    @State private var date: Date = .now
    @State private var preview: ProjMeetPreviewBody?
    @State private var busy: Bool = false
    @State private var message: String?
    @State private var requestId: String = UUID().uuidString
    @State private var removeTarget: ProjMeetRow?

    enum Source: String, CaseIterable, Identifiable {
        case link = "AthleticLIVE link", text = "Paste results"
        var id: String { rawValue }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Label("PROJECTION MEETS", systemImage: "point.3.connected.trianglepath.dotted")
                    .font(.system(size: 11, weight: .heavy)).tracking(0.6).foregroundStyle(Theme.muted)
                Spacer()
                Text(isGlobal ? "EVERY LEAGUE" : "TEST LEAGUE")
                    .font(.system(size: 9, weight: .heavy)).tracking(0.6)
                    .foregroundStyle(isGlobal ? Theme.gold : Theme.flex)
                    .padding(.horizontal, 7).padding(.vertical, 3)
                    .background((isGlobal ? Theme.gold : Theme.flex).opacity(0.15), in: .capsule)
            }
            Text(body_?.scopeNote ?? "Projections only: these meets never score points or set PBs/SBs.")
                .font(.caption).foregroundStyle(Theme.muted)

            if let message {
                HStack(alignment: .top, spacing: 8) {
                    Image(systemName: "server.rack").foregroundStyle(Theme.green)
                    Text(message).font(.caption).foregroundStyle(.white)
                    Spacer(minLength: 0)
                    Button { withAnimation { self.message = nil } } label: { Image(systemName: "xmark").font(.caption2) }
                        .foregroundStyle(Theme.muted)
                }
                .padding(10)
                .background(Theme.greenDeep, in: .rect(cornerRadius: 12))
            }

            addForm
            if let preview { previewCard(preview) }
            list
            rebuildButton
        }
        .card()
        .task { if body_ == nil { body_ = await store.tool(["op": "projMeets"], as: ProjMeetsBody.self) } }
        .confirmationDialog("Remove \(removeTarget?.name ?? "meet")?", isPresented: Binding(get: { removeTarget != nil }, set: { if !$0 { removeTarget = nil } }), titleVisibility: .visible) {
            Button("Remove from projections", role: .destructive) {
                if let t = removeTarget { Task { await remove(t) } }
            }
        } message: {
            Text(isGlobal ? "Every league stops using this meet for projections within 30 minutes. Real scores don't change." : "This test league stops using it for projections. Real scores don't change.")
        }
    }

    // MARK: Add

    private var addForm: some View {
        VStack(alignment: .leading, spacing: 10) {
            Picker("Source", selection: $source) {
                ForEach(Source.allCases) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.segmented)
            .onChange(of: source) { _, _ in preview = nil }

            switch source {
            case .link:
                TextField("https://live.athletic.net/meets/12345", text: $link)
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .pmField()
                    .onChange(of: link) { _, _ in preview = nil }
            case .text:
                TextField("Meet name", text: $name)
                    .pmField()
                    .onChange(of: name) { _, _ in preview = nil }
                DatePicker("Meet date", selection: $date, in: ...Date.now, displayedComponents: .date)
                    .font(.subheadline)
                    .tint(Theme.green)
                    .onChange(of: date) { _, _ in preview = nil }
                TextEditor(text: $text)
                    .font(.system(size: 12, design: .monospaced))
                    .scrollContentBackground(.hidden)
                    .frame(minHeight: 120)
                    .padding(8)
                    .background(Color.white.opacity(0.06), in: .rect(cornerRadius: 10))
                    .overlay(alignment: .topLeading) {
                        if text.isEmpty {
                            Text("Paste results: a table with Event, Name, School, Mark columns, or results text like\nGirls 55 Meter Dash\n1 Jane Doe 11 Cornwall Central 7.45")
                                .font(.system(size: 12, design: .monospaced))
                                .foregroundStyle(Theme.faint)
                                .padding(14)
                                .allowsHitTesting(false)
                        }
                    }
                    .onChange(of: text) { _, _ in preview = nil }
            }

            Button {
                Task { await runPreview() }
            } label: {
                HStack {
                    if busy && preview == nil { ProgressView().tint(.white) } else { Image(systemName: "eye") }
                    Text("Check meet").fontWeight(.bold)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 11)
                .background(Color.white.opacity(0.10), in: .rect(cornerRadius: 12))
                .foregroundStyle(.white)
            }
            .buttonStyle(PressableStyle())
            .disabled(busy || !canPreview)
        }
    }

    private var canPreview: Bool {
        switch source {
        case .link: return !link.trimmingCharacters(in: .whitespaces).isEmpty
        case .text: return !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !name.trimmingCharacters(in: .whitespaces).isEmpty
        }
    }

    private var inputBody: [String: Any] {
        switch source {
        case .link: return ["url": link.trimmingCharacters(in: .whitespaces)]
        case .text: return ["text": text, "name": name.trimmingCharacters(in: .whitespaces), "date": Self.ymd(date)]
        }
    }

    private func previewCard(_ p: ProjMeetPreviewBody) -> some View {
        let matched = (p.results ?? 0) > 0
        return VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(p.preview?.name ?? "Meet").font(.headline).foregroundStyle(.white)
                    Text(p.preview?.date ?? "").font(.caption).foregroundStyle(Theme.muted)
                }
                Spacer()
                Image(systemName: matched ? "checkmark.seal.fill" : "exclamationmark.triangle.fill")
                    .foregroundStyle(matched ? Theme.green : Theme.gold)
            }
            HStack(spacing: 14) {
                metric("\(p.athletes ?? 0)", "athletes")
                metric("\(p.results ?? 0)", "marks")
                metric("\(p.events ?? 0)", "events")
                if (p.skipped ?? 0) > 0 { metric("\(p.skipped ?? 0)", "lines skipped") }
            }
            if let sample = p.sample, !sample.isEmpty {
                VStack(alignment: .leading, spacing: 3) {
                    ForEach(sample.prefix(5)) { s in
                        Text("\(s.name) · \(s.marks.prefix(2).joined(separator: ", "))")
                            .font(.caption2).foregroundStyle(Theme.muted).lineLimit(1)
                    }
                }
            }
            if p.exists == true {
                Text("Already in the list.").font(.caption.weight(.semibold)).foregroundStyle(Theme.gold)
            } else if matched {
                Button {
                    Task { await add() }
                } label: {
                    HStack {
                        if busy { ProgressView().tint(.black) } else { Image(systemName: "plus.circle.fill") }
                        Text("Add to projections").fontWeight(.bold)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 11)
                    .background(Theme.green, in: .rect(cornerRadius: 12))
                    .foregroundStyle(.black)
                }
                .buttonStyle(PressableStyle())
                .disabled(busy)
            } else {
                Text(p.message ?? "No Cornwall Central athletes were matched.").font(.caption).foregroundStyle(Theme.gold)
            }
        }
        .padding(12)
        .background(Color.white.opacity(0.05), in: .rect(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(matched ? Theme.green.opacity(0.35) : Theme.gold.opacity(0.35)))
    }

    private func metric(_ value: String, _ title: String) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(value).font(.system(size: 20, weight: .black).monospacedDigit()).foregroundStyle(.white)
            Text(title).font(.caption2).foregroundStyle(Theme.muted)
        }
    }

    // MARK: List

    @ViewBuilder
    private var list: some View {
        if let b = body_ {
            if let t = b.totals {
                Text("\(t.meets) meets · \(t.results) marks · \(t.athletes) athletes\(b.builtAt.map { " · refreshed \(Self.ago($0))" } ?? "")")
                    .font(.caption.weight(.semibold)).foregroundStyle(Theme.muted)
            }
            if b.meets.isEmpty {
                Text("No meets yet. Projections use this league's own results only.")
                    .font(.caption).foregroundStyle(Theme.faint)
            }
            VStack(spacing: 0) {
                ForEach(b.meets) { m in
                    HStack(spacing: 10) {
                        Image(systemName: m.kind == "TEXT" ? "doc.plaintext" : "link")
                            .font(.caption.weight(.bold))
                            .foregroundStyle(Theme.green)
                            .frame(width: 28, height: 28)
                            .background(Theme.green.opacity(0.12), in: .rect(cornerRadius: 8))
                        VStack(alignment: .leading, spacing: 3) {
                            Text(m.name).font(.subheadline.weight(.semibold)).foregroundStyle(.white).lineLimit(1)
                            HStack(spacing: 6) {
                                Text(m.date).font(.caption2).foregroundStyle(Theme.muted)
                                statusChip(m.stat)
                            }
                        }
                        Spacer(minLength: 0)
                        Button { removeTarget = m } label: {
                            Image(systemName: "minus.circle.fill").font(.title3).foregroundStyle(Theme.red.opacity(0.85))
                        }
                        .buttonStyle(.plain)
                        .disabled(busy)
                        .accessibilityLabel("Remove \(m.name)")
                    }
                    .padding(.vertical, 8)
                    if m.id != b.meets.last?.id { Divider().overlay(Color.white.opacity(0.06)) }
                }
            }
        } else {
            ProgressView().tint(Theme.green).frame(maxWidth: .infinity)
        }
    }

    private func statusChip(_ s: ProjMeetStat?) -> some View {
        let (text, color): (String, Color) = {
            guard let s else { return ("Waiting for rebuild", Theme.faint) }
            if let e = s.error, !e.isEmpty { return (s.kept == true ? "Refresh failed · kept \(s.results)" : "Failed", Theme.red) }
            return ("\(s.results) marks · \(s.athletes) athletes", Theme.green)
        }()
        return Text(text)
            .font(.system(size: 10, weight: .bold))
            .foregroundStyle(color)
            .padding(.horizontal, 6).padding(.vertical, 2)
            .background(color.opacity(0.14), in: .capsule)
    }

    private var rebuildButton: some View {
        Button {
            Task { await rebuild() }
        } label: {
            HStack {
                Image(systemName: "arrow.triangle.2.circlepath")
                Text("Rebuild all now").fontWeight(.bold)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 11)
            .background(Color.white.opacity(0.08), in: .rect(cornerRadius: 12))
            .foregroundStyle(.white)
        }
        .buttonStyle(PressableStyle())
        .disabled(busy || (body_?.meets.isEmpty ?? true))
    }

    // MARK: Actions (one at a time; success only from the server's reply)

    private func runPreview() async {
        guard !busy else { return }
        busy = true
        defer { busy = false }
        var b = inputBody
        b["op"] = "projMeetPreview"
        preview = await store.tool(b, as: ProjMeetPreviewBody.self)
    }

    private func add() async {
        guard !busy else { return }
        busy = true
        defer { busy = false }
        var b = inputBody
        b["op"] = "projMeetAdd"
        b["requestId"] = requestId
        if let r = await store.tool(b, as: ProjMeetsBody.self) {
            apply(r)
            if r.ok {
                preview = nil
                link = ""; text = ""; name = ""
            }
        }
    }

    private func remove(_ m: ProjMeetRow) async {
        guard !busy else { return }
        busy = true
        defer { busy = false; removeTarget = nil }
        if let r = await store.tool(["op": "projMeetRemove", "id": m.id, "requestId": requestId], as: ProjMeetsBody.self) { apply(r) }
    }

    private func rebuild() async {
        guard !busy else { return }
        busy = true
        defer { busy = false }
        if let r = await store.tool(["op": "projMeetsRebuild", "requestId": requestId], as: ProjMeetsBody.self) { apply(r) }
    }

    private func apply(_ r: ProjMeetsBody) {
        withAnimation(.snappy) {
            body_ = r
            message = r.message
        }
        if r.ok && r.duplicate != true { Haptics.success() }
        requestId = UUID().uuidString
    }

    // MARK: Formatting

    private static func ymd(_ d: Date) -> String {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: d)
    }

    private static func ago(_ ms: Double) -> String {
        Date(timeIntervalSince1970: ms / 1000).formatted(.relative(presentation: .named))
    }
}

private extension View {
    func pmField() -> some View {
        font(.subheadline)
            .foregroundStyle(.white)
            .padding(.horizontal, 12)
            .padding(.vertical, 11)
            .background(Color.white.opacity(0.06), in: .rect(cornerRadius: 10))
    }
}
