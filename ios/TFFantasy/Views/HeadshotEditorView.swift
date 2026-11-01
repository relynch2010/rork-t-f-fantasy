import SwiftUI
import UIKit

nonisolated struct PhotoSource: Identifiable, Sendable {
    let id: UUID = UUID()
    let data: Data
}

/// Commissioner headshot editor: auto face-crop + optional background cleanup, then pinch/drag to adjust.
/// The photo is only considered saved once the server confirms it.
struct HeadshotEditorView: View {
    let athlete: Athlete
    let source: PhotoSource

    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var draft: HeadshotDraft?
    @State private var crop: CGRect = .zero
    @State private var gestureStart: CGRect?
    @State private var useCleaned: Bool = true
    @State private var isAnalyzing: Bool = true
    @State private var isSaving: Bool = false
    @State private var failed: Bool = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 18) {
                if let draft {
                    editor(draft)
                } else if failed {
                    EmptyStateView(icon: "photo.badge.exclamationmark", title: "Couldn't read that photo", message: "Try a different image.")
                } else {
                    VStack(spacing: 14) {
                        ProgressView().tint(Theme.green).controlSize(.large)
                        Text("Finding the face…").font(.subheadline).foregroundStyle(Theme.muted)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            .padding(.vertical, 12)
            .background(Color.black)
            .navigationTitle("\(athlete.firstName)'s Headshot")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(isSaving) }
                if let draft {
                    ToolbarItem(placement: .primaryAction) {
                        Button("Auto") {
                            Haptics.tap()
                            withAnimation(.snappy) { crop = draft.crop }
                        }
                        .accessibilityLabel("Reset to automatic crop")
                    }
                }
            }
            .task {
                guard draft == nil, !failed else { return }
                let result = await HeadshotProcessor.analyze(source.data)
                isAnalyzing = false
                if let result {
                    draft = result
                    crop = result.crop
                    useCleaned = result.cleaned != nil
                } else {
                    failed = true
                }
            }
        }
        .presentationBackground(.black)
        .interactiveDismissDisabled(isSaving)
    }

    @ViewBuilder
    private func editor(_ d: HeadshotDraft) -> some View {
        let image = (useCleaned ? d.cleaned : nil) ?? d.original
        GeometryReader { geo in
            let side = max(120, min(geo.size.width - 40, geo.size.height))
            let ds = side / max(crop.width, 1)
            ZStack(alignment: .topLeading) {
                Image(decorative: image, scale: 1)
                    .resizable()
                    .interpolation(.high)
                    .frame(width: CGFloat(image.width) * ds, height: CGFloat(image.height) * ds)
                    .offset(x: -crop.minX * ds, y: -crop.minY * ds)
            }
            .frame(width: side, height: side, alignment: .topLeading)
            .clipped()
            .overlay {
                RoundedRectangle(cornerRadius: side * 0.14, style: .continuous).strokeBorder(.white.opacity(0.85), lineWidth: 2).allowsHitTesting(false)
            }
            .overlay {
                Rectangle().strokeBorder(.white.opacity(0.2), lineWidth: 1).allowsHitTesting(false)
            }
            .contentShape(.rect)
            .gesture(dragGesture(ds: ds, d: d).simultaneously(with: zoomGesture(d: d)))
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .frame(maxHeight: 440)

        VStack(spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: d.confident ? "checkmark.seal.fill" : "exclamationmark.triangle.fill")
                    .foregroundStyle(d.confident ? Theme.green : Theme.gold)
                Text(d.note).font(.footnote).foregroundStyle(Theme.muted).fixedSize(horizontal: false, vertical: true)
            }
            .padding(.horizontal, 24)

            if d.cleaned != nil {
                Toggle(isOn: $useCleaned.animation(.snappy)) {
                    Label("Studio background", systemImage: "person.crop.square.filled.and.at.rectangle")
                        .font(.subheadline.weight(.semibold))
                }
                .tint(Theme.green)
                .padding(.horizontal, 24)
            }

            Text("Pinch to zoom · Drag to reposition")
                .font(.caption)
                .foregroundStyle(Theme.faint)

            PrimaryButton(title: "Save Headshot", systemImage: "checkmark", isLoading: isSaving) { save(d) }
                .padding(.horizontal, 24)
        }
    }

    private func dragGesture(ds: CGFloat, d: HeadshotDraft) -> some Gesture {
        DragGesture()
            .onChanged { v in
                let start = gestureStart ?? crop
                if gestureStart == nil { gestureStart = crop }
                let moved = start.offsetBy(dx: -v.translation.width / ds, dy: -v.translation.height / ds)
                crop = HeadshotProcessor.clampSquare(moved, width: CGFloat(d.original.width), height: CGFloat(d.original.height))
            }
            .onEnded { _ in gestureStart = nil }
    }

    private func zoomGesture(d: HeadshotDraft) -> some Gesture {
        MagnifyGesture()
            .onChanged { v in
                let start = gestureStart ?? crop
                if gestureStart == nil { gestureStart = crop }
                let maxSide = min(CGFloat(d.original.width), CGFloat(d.original.height))
                let sideLen = min(maxSide, max(64, start.width / max(v.magnification, 0.01)))
                let r = CGRect(x: start.midX - sideLen / 2, y: start.midY - sideLen / 2, width: sideLen, height: sideLen)
                crop = HeadshotProcessor.clampSquare(r, width: CGFloat(d.original.width), height: CGFloat(d.original.height))
            }
            .onEnded { _ in gestureStart = nil }
    }

    private func save(_ d: HeadshotDraft) {
        guard !isSaving else { return }
        isSaving = true
        let image = (useCleaned ? d.cleaned : nil) ?? d.original
        let rect = crop
        Task {
            guard let jpeg = await HeadshotProcessor.render(source: image, crop: rect) else {
                isSaving = false
                store.errorMessage = "That photo couldn't be processed. Try another one."
                return
            }
            let ok = await store.saveAthletePhoto(athleteId: athlete.id, jpeg: jpeg, expectAt: athlete.photoAt)
            isSaving = false
            if ok { dismiss() }
        }
    }
}
