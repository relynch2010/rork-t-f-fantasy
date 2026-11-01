import CoreImage
import CoreImage.CIFilterBuiltins
import UIKit
import Vision

/// Result of analyzing a supplied photo: the source image, an optional background-cleaned copy,
/// and a suggested square headshot crop (image pixel coordinates, top-left origin).
nonisolated struct HeadshotDraft: @unchecked Sendable {
    let original: CGImage
    let cleaned: CGImage?
    let crop: CGRect
    /// True only when exactly one clear face was found and the crop didn't have to cut it off.
    let confident: Bool
    let note: String
}

/// On-device headshot pipeline (Vision + Core Image). Nothing leaves the phone until the commissioner confirms.
/// Detects the face → crops head-and-shoulders → optionally replaces the background → upsamples/sharpens gently → JPEG.
/// It never generates or alters facial detail; it only crops, scales, lightly sharpens and masks the background.
nonisolated enum HeadshotProcessor {
    static let outputSide: CGFloat = 600
    /// Stays under the server's 120,000-character base64 limit.
    static let maxBytes: Int = 86_000
    private static let maxWorkingSide: CGFloat = 2048
    private static let context = CIContext(options: [.useSoftwareRenderer: false])

    static func analyze(_ data: Data) async -> HeadshotDraft? {
        await Task.detached(priority: .userInitiated) { analyzeSync(data) }.value
    }

    static func render(source: CGImage, crop: CGRect) async -> Data? {
        await Task.detached(priority: .userInitiated) { renderSync(source: source, crop: crop) }.value
    }

    // MARK: Analysis

    private static func analyzeSync(_ data: Data) -> HeadshotDraft? {
        guard let loaded = UIImage(data: data), let cg = normalized(loaded) else { return nil }
        let w = CGFloat(cg.width), h = CGFloat(cg.height)
        let faceReq = VNDetectFaceRectanglesRequest()
        let segReq = VNGeneratePersonSegmentationRequest()
        segReq.qualityLevel = .accurate
        segReq.outputPixelFormat = kCVPixelFormatType_OneComponent8
        let handler = VNImageRequestHandler(cgImage: cg, options: [:])
        do { try handler.perform([faceReq]) } catch { print("[Headshot] face detection failed: \(error.localizedDescription)") }
        var segmentation: CVPixelBuffer?
        do {
            try handler.perform([segReq])
            segmentation = segReq.results?.first?.pixelBuffer
        } catch {
            print("[Headshot] segmentation unavailable: \(error.localizedDescription)")
        }

        let faces = (faceReq.results ?? [])
            .filter { $0.confidence >= 0.6 }
            .map { obs -> CGRect in
                let b = obs.boundingBox
                return CGRect(x: b.minX * w, y: (1 - b.maxY) * h, width: b.width * w, height: b.height * h)
            }
            .sorted { $0.width * $0.height > $1.width * $1.height }

        var note = ""
        var confident = false
        let crop: CGRect
        if let face = faces.first, faces.count == 1 || (faces.count > 1 && area(face) >= area(faces[1]) * 2.2) {
            let ideal = headshotCrop(face: face)
            crop = clampSquare(ideal, width: w, height: h)
            let shift = hypot(crop.midX - ideal.midX, crop.midY - ideal.midY)
            let tooSmall = face.width < 48
            confident = shift < ideal.width * 0.12 && crop.width >= ideal.width * 0.8 && !tooSmall
            if tooSmall { note = "The face is small in this photo, so it may look soft. Zoom and position it, or try a closer photo." }
            else if !confident { note = "The face is near the edge of the photo. Check the crop before saving." }
            else if faces.count > 1 { note = "Several people found. Centered on the largest face." }
            else { note = "Auto-cropped to a headshot. Adjust if needed." }
        } else {
            let side = min(w, h)
            crop = CGRect(x: (w - side) / 2, y: max(0, (h - side) * 0.25), width: side, height: side)
            note = faces.isEmpty
                ? "No clear face found. Position the headshot yourself."
                : "More than one face found. Position the right person yourself."
        }

        var cleaned: CGImage?
        if let mask = segmentation { cleaned = cleanBackground(cg, mask: mask) }
        if segmentation != nil && cleaned == nil && note.isEmpty { note = "Couldn't separate the person from the background." }
        return HeadshotDraft(original: cg, cleaned: cleaned, crop: crop, confident: confident, note: note)
    }

    private static func area(_ r: CGRect) -> CGFloat { r.width * r.height }

    /// Head-and-shoulders square: face ~40% of the frame, eyes in the upper third, like fantasy app headshots.
    static func headshotCrop(face: CGRect) -> CGRect {
        let side = max(face.width, face.height) * 2.5
        let cx = face.midX
        let cy = face.midY + side * 0.1
        return CGRect(x: cx - side / 2, y: cy - side / 2, width: side, height: side)
    }

    /// Fits a square inside the image, shrinking only if needed and sliding it back inside the bounds.
    static func clampSquare(_ r: CGRect, width w: CGFloat, height h: CGFloat) -> CGRect {
        let side = min(r.width, w, h)
        let cx = min(max(r.midX, side / 2), w - side / 2)
        let cy = min(max(r.midY, side / 2), h - side / 2)
        return CGRect(x: cx - side / 2, y: cy - side / 2, width: side, height: side)
    }

    /// Replaces the background with a neutral studio gradient using the person mask. Returns nil when the mask isn't a clear single subject.
    private static func cleanBackground(_ cg: CGImage, mask: CVPixelBuffer) -> CGImage? {
        let image = CIImage(cgImage: cg)
        var maskImage = CIImage(cvPixelBuffer: mask)
        let sx = image.extent.width / maskImage.extent.width
        let sy = image.extent.height / maskImage.extent.height
        maskImage = maskImage.transformed(by: CGAffineTransform(scaleX: sx, y: sy))
        let avg = CIFilter.areaAverage()
        avg.inputImage = maskImage
        avg.extent = maskImage.extent
        var px: [UInt8] = [0, 0, 0, 0]
        if let out = avg.outputImage {
            context.render(out, toBitmap: &px, rowBytes: 4, bounds: CGRect(x: 0, y: 0, width: 1, height: 1), format: .RGBA8, colorSpace: nil)
        }
        let coverage = Double(px[0]) / 255
        guard coverage > 0.04, coverage < 0.95 else { return nil }
        let soft = maskImage.clampedToExtent().applyingGaussianBlur(sigma: 1.2).cropped(to: image.extent)

        let gradient = CIFilter.radialGradient()
        gradient.center = CGPoint(x: image.extent.midX, y: image.extent.maxY * 0.62)
        gradient.radius0 = Float(min(image.extent.width, image.extent.height) * 0.1)
        gradient.radius1 = Float(max(image.extent.width, image.extent.height) * 0.75)
        gradient.color0 = CIColor(red: 0.36, green: 0.40, blue: 0.44)
        gradient.color1 = CIColor(red: 0.15, green: 0.18, blue: 0.20)
        guard let background = gradient.outputImage?.cropped(to: image.extent) else { return nil }

        let blend = CIFilter.blendWithMask()
        blend.inputImage = image
        blend.backgroundImage = background
        blend.maskImage = soft
        guard let out = blend.outputImage else { return nil }
        return context.createCGImage(out, from: image.extent)
    }

    // MARK: Rendering

    private static func renderSync(source: CGImage, crop: CGRect) -> Data? {
        let h = CGFloat(source.height)
        let rect = clampSquare(crop, width: CGFloat(source.width), height: h).integral
        guard rect.width >= 8 else { return nil }
        let ciRect = CGRect(x: rect.minX, y: h - rect.maxY, width: rect.width, height: rect.height)
        var img = CIImage(cgImage: source).cropped(to: ciRect)
            .transformed(by: CGAffineTransform(translationX: -ciRect.minX, y: -ciRect.minY))
        let scale = outputSide / rect.width
        let lanczos = CIFilter.lanczosScaleTransform()
        lanczos.inputImage = img
        lanczos.scale = Float(scale)
        lanczos.aspectRatio = 1
        if let out = lanczos.outputImage { img = out }
        // Gentle luminance sharpening only; stronger when the crop had to be enlarged.
        let sharpen = CIFilter.sharpenLuminance()
        sharpen.inputImage = img
        sharpen.sharpness = scale > 1.3 ? 0.45 : 0.25
        sharpen.radius = 1.4
        if let out = sharpen.outputImage { img = out }
        let outRect = CGRect(x: 0, y: 0, width: outputSide, height: outputSide)
        guard let cg = context.createCGImage(img.cropped(to: outRect), from: outRect) else { return nil }
        let ui = UIImage(cgImage: cg)
        for q in [0.86, 0.78, 0.7, 0.6, 0.5, 0.4] {
            if let data = ui.jpegData(compressionQuality: q), data.count <= maxBytes { return data }
        }
        return nil
    }

    /// Bakes EXIF orientation into pixels and caps the working size.
    private static func normalized(_ img: UIImage) -> CGImage? {
        let size = img.size
        guard size.width > 0, size.height > 0 else { return nil }
        let k = min(1, maxWorkingSide / max(size.width * img.scale, size.height * img.scale))
        let target = CGSize(width: (size.width * img.scale * k).rounded(), height: (size.height * img.scale * k).rounded())
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        return UIGraphicsImageRenderer(size: target, format: format).image { _ in
            img.draw(in: CGRect(origin: .zero, size: target))
        }.cgImage
    }
}
