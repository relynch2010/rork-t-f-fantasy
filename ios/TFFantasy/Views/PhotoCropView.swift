import SwiftUI
import UIKit

/// Square crop for team photos: pinch to zoom, drag to reposition, confirm.
struct PhotoCropView: View {
    let data: Data

    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var image: UIImage?
    @State private var scale: CGFloat = 1
    @State private var lastScale: CGFloat = 1
    @State private var offset: CGSize = .zero
    @State private var lastOffset: CGSize = .zero
    @State private var isSaving: Bool = false

    private let outputSide: CGFloat = 400

    var body: some View {
        NavigationStack {
            GeometryReader { geo in
                let side = min(geo.size.width - 32, geo.size.height - 160)
                VStack(spacing: 20) {
                    Spacer(minLength: 0)
                    ZStack {
                        if let image {
                            Image(uiImage: image)
                                .resizable()
                                .aspectRatio(contentMode: .fill)
                                .frame(width: side * scale * aspect(image).w, height: side * scale * aspect(image).h)
                                .offset(offset)
                                .frame(width: side, height: side)
                                .clipped()
                        } else {
                            ProgressView().tint(Theme.green)
                        }
                        RoundedRectangle(cornerRadius: side * 0.14, style: .continuous)
                            .strokeBorder(.white.opacity(0.9), lineWidth: 2)
                            .frame(width: side, height: side)
                            .allowsHitTesting(false)
                        Rectangle()
                            .strokeBorder(.white.opacity(0.25), lineWidth: 1)
                            .frame(width: side, height: side)
                            .allowsHitTesting(false)
                    }
                    .frame(width: side, height: side)
                    .contentShape(.rect)
                    .gesture(dragGesture(side: side).simultaneously(with: zoomGesture(side: side)))
                    .frame(maxWidth: .infinity)

                    Text("Pinch to zoom · Drag to move")
                        .font(.subheadline)
                        .foregroundStyle(Theme.muted)

                    PrimaryButton(title: "Use Photo", systemImage: "checkmark", isLoading: isSaving) {
                        confirm(side: side)
                    }
                    .disabled(image == nil)
                    .padding(.horizontal, 24)
                    Spacer(minLength: 0)
                }
            }
            .background(Color.black)
            .navigationTitle("Crop Photo")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .primaryAction) {
                    Button("Reset") {
                        withAnimation(.snappy) { scale = 1; lastScale = 1; offset = .zero; lastOffset = .zero }
                    }
                }
            }
            .task {
                image = UIImage(data: data).map(Self.normalized)
                if image == nil {
                    store.errorMessage = "That photo couldn't be read. Try another one."
                    dismiss()
                }
            }
        }
        .presentationBackground(.black)
    }

    /// Image size relative to the crop square when "filled" at scale 1.
    private func aspect(_ img: UIImage) -> (w: CGFloat, h: CGFloat) {
        let w = img.size.width, h = img.size.height
        guard w > 0, h > 0 else { return (1, 1) }
        return w >= h ? (w / h, 1) : (1, h / w)
    }

    private func clamp(_ proposed: CGSize, side: CGFloat, scale: CGFloat) -> CGSize {
        guard let image else { return .zero }
        let a = aspect(image)
        let maxX = max(0, (side * scale * a.w - side) / 2)
        let maxY = max(0, (side * scale * a.h - side) / 2)
        return CGSize(width: min(maxX, max(-maxX, proposed.width)), height: min(maxY, max(-maxY, proposed.height)))
    }

    private func dragGesture(side: CGFloat) -> some Gesture {
        DragGesture()
            .onChanged { v in
                offset = clamp(CGSize(width: lastOffset.width + v.translation.width, height: lastOffset.height + v.translation.height), side: side, scale: scale)
            }
            .onEnded { _ in lastOffset = offset }
    }

    private func zoomGesture(side: CGFloat) -> some Gesture {
        MagnifyGesture()
            .onChanged { v in
                scale = min(5, max(1, lastScale * v.magnification))
                offset = clamp(offset, side: side, scale: scale)
            }
            .onEnded { _ in
                lastScale = scale
                lastOffset = offset
            }
    }

    private func confirm(side: CGFloat) {
        guard let image, !isSaving else { return }
        let a = aspect(image)
        let drawnW = side * scale * a.w
        let drawnH = side * scale * a.h
        // Top-left of the drawn image relative to the crop square.
        let originX = (side - drawnW) / 2 + offset.width
        let originY = (side - drawnH) / 2 + offset.height
        let k = outputSide / side
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let cropped = UIGraphicsImageRenderer(size: CGSize(width: outputSide, height: outputSide), format: format).image { _ in
            image.draw(in: CGRect(x: originX * k, y: originY * k, width: drawnW * k, height: drawnH * k))
        }
        isSaving = true
        Task {
            let ok = await store.uploadTeamPhoto(cropped)
            isSaving = false
            if ok { dismiss() }
        }
    }

    /// Bakes EXIF orientation into pixels so the crop math matches what's on screen.
    private static func normalized(_ img: UIImage) -> UIImage {
        guard img.imageOrientation != .up else { return img }
        let format = UIGraphicsImageRendererFormat()
        format.scale = img.scale
        return UIGraphicsImageRenderer(size: img.size, format: format).image { _ in img.draw(in: CGRect(origin: .zero, size: img.size)) }
    }
}
