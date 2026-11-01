import SwiftUI
import UniformTypeIdentifiers

/// Commissioner Tools → Athlete Editor → Import Roster (school leagues only).
/// Paste a list or pick a CSV, preview how every row is sorted, then add only the new players.
/// Nothing on file is ever overwritten; the server decides every row.
struct RosterImportView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var text: String = ""
    @State private var preview: ImportResult?
    @State private var committed: ImportResult?
    @State private var confirmed: Set<Int> = []
    @State private var requestId: String = UUID().uuidString
    @State private var isWorking: Bool = false
    @State private var pickFile: Bool = false
    @State private var fileError: String?

    private var rows: [[String: Any]] { Self.parse(text, confirmed: confirmed) }

    var body: some View {
        NavigationStack {
            List {
                if let done = committed {
                    resultSection(done)
                } else {
                    inputSection
                    if let p = preview { previewSections(p) }
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.bg)
            .navigationTitle("Import Roster")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(committed == nil ? "Cancel" : "Done") { dismiss() } }
            }
            .fileImporter(isPresented: $pickFile, allowedContentTypes: [.commaSeparatedText, .plainText, .tabSeparatedText]) { result in
                loadFile(result)
            }
            .onChange(of: text) { _, _ in
                preview = nil
                confirmed = []
                requestId = UUID().uuidString
            }
        }
        .presentationDetents([.large])
    }

    // MARK: Sections

    private var inputSection: some View {
        Section {
            TextEditor(text: $text)
                .font(.system(size: 13).monospaced())
                .frame(minHeight: 160)
                .scrollContentBackground(.hidden)
                .textInputAutocapitalization(.words)
                .autocorrectionDisabled()
                .overlay(alignment: .topLeading) {
                    if text.isEmpty {
                        Text("Jordan Ellis, B, SPR, 11\nMaya Brooks, G, DIS/FLD, 10")
                            .font(.system(size: 13).monospaced())
                            .foregroundStyle(Theme.faint)
                            .padding(.top, 8).padding(.leading, 5)
                            .allowsHitTesting(false)
                    }
                }
                .listRowBackground(Theme.surface)
            Button("Choose a CSV File", systemImage: "doc.badge.plus") { pickFile = true }
                .listRowBackground(Theme.surface)
            if let fileError {
                Text(fileError).font(.caption).foregroundStyle(Theme.red).listRowBackground(Theme.surface)
            }
            PrimaryButton(title: preview == nil ? "Preview" : "Preview Again", systemImage: "eye", isLoading: isWorking && preview == nil) { runPreview() }
                .disabled(rows.isEmpty || isWorking)
                .opacity(rows.isEmpty ? 0.45 : 1)
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets(top: 8, leading: 0, bottom: 8, trailing: 0))
        } header: {
            Text("\(store.league?.schoolName ?? "School") roster")
        } footer: {
            Text("One player per line: name, gender (B or G), position (SPR, DIS, FLD, FLEX or a combo like SPR/DIS), and grade. A header row is fine. Up to 400 players. Players are added for \(store.league?.schoolName ?? "this school") and shared with every league at that school.")
        }
    }

    @ViewBuilder
    private func previewSections(_ p: ImportResult) -> some View {
        Section {
            summaryRow(p.summary, committedRun: false)
                .listRowBackground(Theme.surface)
        } header: {
            Text("Preview — nothing saved yet")
        }
        group(p, "new", "New players", "Will be added.")
        group(p, "possible", "Possible duplicates", "These look like a player already on file. Turn one on only if it's a different person.")
        group(p, "existing", "Already on file", "Nothing changes for these players.")
        group(p, "invalid", "Can't be added", "Fix these lines and preview again.")
        Section {
            let count = p.summary.new + confirmed.count
            PrimaryButton(title: count == 0 ? "Nothing to Add" : "Add \(count) Player\(count == 1 ? "" : "s")", systemImage: "person.3.fill", isLoading: isWorking) { commit() }
                .disabled(count == 0 || isWorking)
                .opacity(count == 0 ? 0.45 : 1)
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets())
        } footer: {
            Text("Only new players are added. Existing players and anything already confirmed are never overwritten.")
        }
    }

    @ViewBuilder
    private func group(_ p: ImportResult, _ status: String, _ title: String, _ note: String) -> some View {
        let items = p.rows.filter { $0.status == status }
        if !items.isEmpty {
            Section {
                ForEach(items) { r in
                    if status == "possible" {
                        Toggle(isOn: Binding(
                            get: { confirmed.contains(r.row) },
                            set: { on in if on { confirmed.insert(r.row) } else { confirmed.remove(r.row) } }
                        )) {
                            rowLabel(r, status)
                        }
                        .tint(Theme.gold)
                        .listRowBackground(Theme.surface)
                    } else {
                        rowLabel(r, status).listRowBackground(Theme.surface)
                    }
                }
            } header: {
                Text("\(title) · \(items.count)")
            } footer: {
                Text(note)
            }
        }
    }

    private func rowLabel(_ r: ImportRowResult, _ status: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: icon(status))
                .foregroundStyle(tint(status))
                .frame(width: 20)
            VStack(alignment: .leading, spacing: 2) {
                Text(r.name.isEmpty ? "Line \(r.row)" : r.name).font(.system(size: 15, weight: .semibold)).foregroundStyle(.white)
                Text([r.gender, r.position].filter { !$0.isEmpty }.joined(separator: " • ")).font(.caption).foregroundStyle(Theme.muted)
                if let reason = r.reason, status != "new" {
                    Text(reason).font(.caption).foregroundStyle(status == "invalid" ? Theme.red : Theme.muted)
                }
            }
        }
        .padding(.vertical, 2)
    }

    private func resultSection(_ r: ImportResult) -> some View {
        Section {
            VStack(alignment: .leading, spacing: 10) {
                Label(r.summary.added == 0 ? "No new players" : "\(r.summary.added) player\(r.summary.added == 1 ? "" : "s") added", systemImage: "checkmark.seal.fill")
                    .font(.headline)
                    .foregroundStyle(Theme.green)
                summaryRow(r.summary, committedRun: true)
                if r.repeated == true {
                    Text("This import was already saved. Nothing was added twice.").font(.caption).foregroundStyle(Theme.muted)
                }
            }
            .padding(.vertical, 6)
            .listRowBackground(Theme.surface)
        } footer: {
            Text("New players are now in every league at \(r.school ?? store.league?.schoolName ?? "this school"). Possible duplicates you didn't confirm were left out.")
        }
    }

    private func summaryRow(_ s: ImportSummary, committedRun: Bool) -> some View {
        HStack(spacing: 0) {
            stat(committedRun ? s.added : s.new, committedRun ? "Added" : "New", Theme.green)
            stat(s.existing, "On file", Theme.muted)
            stat(s.possible, "Check", Theme.gold)
            stat(s.invalid, "Invalid", Theme.red)
        }
    }

    private func stat(_ n: Int, _ label: String, _ color: Color) -> some View {
        VStack(spacing: 2) {
            Text("\(n)").font(.system(size: 22, weight: .black, design: .rounded)).foregroundStyle(n == 0 ? Theme.faint : color)
            Text(label.uppercased()).font(.system(size: 10, weight: .heavy)).tracking(0.5).foregroundStyle(Theme.muted)
        }
        .frame(maxWidth: .infinity)
    }

    private func icon(_ s: String) -> String {
        switch s {
        case "new": return "plus.circle.fill"
        case "possible": return "questionmark.circle.fill"
        case "existing": return "checkmark.circle"
        default: return "xmark.octagon.fill"
        }
    }

    private func tint(_ s: String) -> Color {
        switch s {
        case "new": return Theme.green
        case "possible": return Theme.gold
        case "existing": return Theme.muted
        default: return Theme.red
        }
    }

    // MARK: Actions

    private func runPreview() {
        guard !isWorking else { return }
        isWorking = true
        let body: [String: Any] = ["op": "importRoster", "mode": "preview", "rows": rows]
        Task {
            if let r = await store.tool(body, as: ImportResult.self) {
                preview = r
                confirmed = []
                Haptics.success()
            }
            isWorking = false
        }
    }

    private func commit() {
        guard !isWorking else { return }
        isWorking = true
        let body: [String: Any] = ["op": "importRoster", "mode": "commit", "rows": rows, "requestId": requestId]
        Task {
            if let r = await store.tool(body, as: ImportResult.self) {
                committed = r
                await store.fetchLeague(force: true)
                Haptics.success()
            }
            isWorking = false
        }
    }

    private func loadFile(_ result: Result<URL, Error>) {
        fileError = nil
        guard case .success(let url) = result else { fileError = "That file couldn't be opened."; return }
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        guard let data = try? Data(contentsOf: url), data.count < 512_000,
              let s = String(data: data, encoding: .utf8) ?? String(data: data, encoding: .isoLatin1) else {
            fileError = "That file couldn't be read. Save it as CSV and try again."
            return
        }
        text = s
    }

    // MARK: Parsing (the server re-checks every field)

    /// Lines → rows. Accepts comma, tab or semicolon separated; skips a header row and blank lines.
    /// Line numbers match the preview so "possible duplicate" confirmations stay on the right row.
    static func parse(_ text: String, confirmed: Set<Int>) -> [[String: Any]] {
        var out: [[String: Any]] = []
        let lines = text.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n").split(separator: "\n", omittingEmptySubsequences: false)
        for raw in lines {
            let line = raw.trimmingCharacters(in: .whitespaces)
            if line.isEmpty { continue }
            let sep: Character = line.contains("\t") ? "\t" : line.contains(";") && !line.contains(",") ? ";" : ","
            let cols = line.split(separator: sep, omittingEmptySubsequences: false).map { $0.trimmingCharacters(in: .whitespaces).trimmingCharacters(in: CharacterSet(charactersIn: "\"")) }
            if out.isEmpty, let first = cols.first?.lowercased(), first == "name" || first == "athlete" || first == "full name" { continue }
            var row: [String: Any] = [
                "name": (cols.count > 0 ? cols[0] : nil) ?? "",
                "gender": (cols.count > 1 ? cols[1] : nil) ?? "",
                "position": (cols.count > 2 ? cols[2] : nil) ?? "",
                "grade": (cols.count > 3 ? cols[3] : nil) ?? "",
            ]
            if confirmed.contains(out.count + 1) { row["confirmNew"] = true }
            out.append(row)
        }
        return Array(out.prefix(400))
    }
}
