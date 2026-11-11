// Stereo 180° movie for Apple Vision Pro from the browser's HEVC files
// (src/export/vr180-page.ts, src/export/vr180-video.ts): MV-HEVC with Apple
// Projected Media Profile signalling (half-equirectangular, left and right
// eye), audio copied as is.
//
//   swiftc -O tools/apmp/join.swift -o tools/apmp/join
//   tools/apmp/join out.mov sbs.mp4                    side by side, up to 4096 per eye
//   tools/apmp/join out.mov L0.mp4 L1.mp4 R0.mp4 R1.mp4 each eye as top and bottom halves
//   tools/apmp/join out.mov --segments DIR --fps 30    a whole show, streamed (below)
//   options: --mbps 80     average bitrate (Apple asks for peaks under 150)
//            --quality 0.9 constant quality instead (0..1); the encoder
//                          undershoots an average bitrate on this dark,
//                          mostly empty picture and blurs the spray
//
// Joining tiles here, not in the browser, because the browser's HEVC encoder
// stops at about 8192 x 4320 per frame while VideoToolbox encodes MV-HEVC
// up to 8192 x 8192 per eye on this Mac.
//
// --segments: the player (動画を書き出す → Vision Pro) uploads the show in
// short pieces while it renders, so the intermediate files never have to fit
// on disk at once. DIR holds, as they arrive:
//   audio.mp4                  the music for the whole range (optional, there before start)
//   0000_sbs.mp4 | 0000_L0.mp4 0000_L1.mp4 0000_R0.mp4 0000_R1.mp4
//   0000.ready                 that piece is complete
//   end                        no more pieces
// Each piece is deleted once encoded. Progress goes to stdout as
// "frames N" lines.

import AVFoundation
import CoreMedia
import VideoToolbox

var args = Array(CommandLine.arguments.dropFirst())
func option(_ name: String) -> String? {
    guard let i = args.firstIndex(of: name), i + 1 < args.count else { return nil }
    let v = args[i + 1]
    args.removeSubrange(i...(i + 1))
    return v
}
let mbps = option("--mbps").flatMap(Double.init) ?? 80
let quality = option("--quality").flatMap(Double.init)
let segmentDir = option("--segments").map { URL(fileURLWithPath: $0) }
let segmentFps = option("--fps").flatMap(Int32.init) ?? 30
guard segmentDir != nil ? args.count == 1 : (args.count == 2 || args.count == 5) else {
    print("usage: join out.mov sbs.mp4 | join out.mov L0.mp4 L1.mp4 R0.mp4 R1.mp4 | join out.mov --segments DIR --fps 30  [--mbps 80 | --quality 0.85]")
    exit(2)
}
let outURL = URL(fileURLWithPath: args[0])

struct Source {
    let reader: AVAssetReader
    let output: AVAssetReaderTrackOutput
    let width: Int
    let height: Int
}

func open(_ url: URL) async throws -> Source {
    let asset = AVURLAsset(url: url)
    let track = try await asset.loadTracks(withMediaType: .video)[0]
    let size = try await track.load(.naturalSize)
    let reader = try AVAssetReader(asset: asset)
    let output = AVAssetReaderTrackOutput(track: track, outputSettings: [
        kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange,
    ])
    output.alwaysCopiesSampleData = false
    reader.add(output)
    reader.startReading()
    return Source(reader: reader, output: output, width: Int(size.width), height: Int(size.height))
}

/// Copy a w x h block of a 4:2:0 bi-planar buffer (both planes).
func copy(_ src: CVPixelBuffer, sx: Int, sy: Int, to dst: CVPixelBuffer, dx: Int, dy: Int, w: Int, h: Int) {
    for plane in 0..<2 {
        let sub = plane == 0 ? 1 : 2
        let sBase = CVPixelBufferGetBaseAddressOfPlane(src, plane)!
        let dBase = CVPixelBufferGetBaseAddressOfPlane(dst, plane)!
        let sRow = CVPixelBufferGetBytesPerRowOfPlane(src, plane)
        let dRow = CVPixelBufferGetBytesPerRowOfPlane(dst, plane)
        // chroma: half the rows, and each row holds Cb Cr pairs for half the columns
        let bytes = w, rows = h / sub
        for r in 0..<rows {
            memcpy(dBase + (dy / sub + r) * dRow + dx, sBase + (sy / sub + r) * sRow + sx, bytes)
        }
    }
}

let fm = FileManager.default
func exists(_ url: URL) -> Bool { fm.fileExists(atPath: url.path) }

/// The files of the next piece: one side-by-side file or four tiles. nil when there are no more.
func nextPiece(_ k: Int) async throws -> [URL]? {
    guard let dir = segmentDir else { return k == 0 ? args.dropFirst().map { URL(fileURLWithPath: $0) } : nil }
    let stem = String(format: "%04d", k)
    let ready = dir.appendingPathComponent("\(stem).ready")
    while !exists(ready) {
        if exists(dir.appendingPathComponent("end")) { return nil }
        try await Task.sleep(nanoseconds: 200_000_000)
    }
    let sbs = dir.appendingPathComponent("\(stem)_sbs.mp4")
    if exists(sbs) { return [sbs] }
    return ["L0", "L1", "R0", "R1"].map { dir.appendingPathComponent("\(stem)_\($0).mp4") }
}

let sem = DispatchSemaphore(value: 0)
Task {
    do {
        var writer: AVAssetWriter!
        var input: AVAssetWriterInput!
        var adaptor: AVAssetWriterInputTaggedPixelBufferGroupAdaptor!
        // the reader too: an output alone does not keep its reader alive
        var audioReader: AVAssetReader?
        var audioOut: AVAssetReaderTrackOutput?
        var audioIn: AVAssetWriterInput?
        var eye = 0
        var frames = 0
        let start = Date()

        func setUp(first: [URL], sources: [Source]) async throws {
            let sbs = first.count == 1
            eye = sbs ? sources[0].width / 2 : sources[0].width
            let fps: Float = segmentDir != nil
                ? Float(segmentFps)
                : try await AVURLAsset(url: first[0]).loadTracks(withMediaType: .video)[0].load(.nominalFrameRate)
            try? fm.removeItem(at: outURL)
            writer = try AVAssetWriter(outputURL: outURL, fileType: .mov)
            var props: [CFString: Any] = [
                kVTCompressionPropertyKey_MVHEVCVideoLayerIDs: [0, 1],
                kVTCompressionPropertyKey_MVHEVCViewIDs: [0, 1],
                kVTCompressionPropertyKey_MVHEVCLeftAndRightViewIDs: [0, 1],
                kVTCompressionPropertyKey_HasLeftStereoEyeView: true,
                kVTCompressionPropertyKey_HasRightStereoEyeView: true,
                kVTCompressionPropertyKey_ProjectionKind: kCMFormatDescriptionProjectionKind_HalfEquirectangular,
                kVTCompressionPropertyKey_ExpectedFrameRate: fps,
                kVTCompressionPropertyKey_MaxKeyFrameIntervalDuration: 2,
            ]
            if let q = quality {
                props[kVTCompressionPropertyKey_Quality] = q
            } else {
                props[kVTCompressionPropertyKey_AverageBitRate] = Int(mbps * 1_000_000)
            }
            input = AVAssetWriterInput(mediaType: .video, outputSettings: [
                AVVideoCodecKey: AVVideoCodecType.hevc,
                AVVideoWidthKey: eye,
                AVVideoHeightKey: eye,
                AVVideoCompressionPropertiesKey: props,
                // SDR Rec. 709, as Apple's own conversion writes it; untagged,
                // players fall back to other matrices and shift the colours
                AVVideoColorPropertiesKey: [
                    AVVideoColorPrimariesKey: AVVideoColorPrimaries_ITU_R_709_2,
                    AVVideoTransferFunctionKey: AVVideoTransferFunction_ITU_R_709_2,
                    AVVideoYCbCrMatrixKey: AVVideoYCbCrMatrix_ITU_R_709_2,
                ],
            ])
            input.expectsMediaDataInRealTime = false
            adaptor = AVAssetWriterInputTaggedPixelBufferGroupAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [
                kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange,
                kCVPixelBufferWidthKey as String: eye,
                kCVPixelBufferHeightKey as String: eye,
                kCVPixelBufferIOSurfacePropertiesKey as String: [:],
            ])
            writer.add(input)

            // the music: the first file's own track, or the separate file of a streamed show
            let audioURL = segmentDir.map { $0.appendingPathComponent("audio.mp4") } ?? first[0]
            if exists(audioURL) {
                let asset = AVURLAsset(url: audioURL)
                if let a = try await asset.loadTracks(withMediaType: .audio).first {
                    let reader = try AVAssetReader(asset: asset)
                    let o = AVAssetReaderTrackOutput(track: a, outputSettings: nil)
                    reader.add(o)
                    reader.startReading()
                    let hint = try await a.load(.formatDescriptions).first
                    let ai = AVAssetWriterInput(mediaType: .audio, outputSettings: nil, sourceFormatHint: hint)
                    writer.add(ai)
                    audioReader = reader
                    audioOut = o
                    audioIn = ai
                }
            }
            writer.startWriting()
            writer.startSession(atSourceTime: .zero)
        }

        var k = 0
        while let piece = try await nextPiece(k) {
            var sources: [Source] = []
            for url in piece { sources.append(try await open(url)) }
            if writer == nil { try await setUp(first: piece, sources: sources) }
            let sbs = piece.count == 1
            pieceLoop: while true {
                var bufs: [CMSampleBuffer] = []
                for s in sources {
                    guard let b = s.output.copyNextSampleBuffer() else { break pieceLoop }
                    bufs.append(b)
                }
                // pieces each start at zero; the frame count places them in the show
                let pts = segmentDir != nil
                    ? CMTime(value: CMTimeValue(frames), timescale: segmentFps)
                    : CMSampleBufferGetPresentationTimeStamp(bufs[0])
                guard let pool = adaptor.pixelBufferPool else { throw NSError(domain: "join", code: 1, userInfo: [NSLocalizedDescriptionKey: "no pixel buffer pool: \(String(describing: writer.error))"]) }
                var eyes: [CVPixelBuffer] = []
                for _ in 0..<2 {
                    var pb: CVPixelBuffer?
                    CVPixelBufferPoolCreatePixelBuffer(nil, pool, &pb)
                    eyes.append(pb!)
                }
                let images = bufs.map { CMSampleBufferGetImageBuffer($0)! }
                for b in images + eyes { CVPixelBufferLockBaseAddress(b, []) }
                if sbs {
                    copy(images[0], sx: 0, sy: 0, to: eyes[0], dx: 0, dy: 0, w: eye, h: eye)
                    copy(images[0], sx: eye, sy: 0, to: eyes[1], dx: 0, dy: 0, w: eye, h: eye)
                } else {
                    let half = eye / 2
                    for k in 0..<4 {
                        copy(images[k], sx: 0, sy: 0, to: eyes[k / 2], dx: 0, dy: (k % 2) * half, w: eye, h: half)
                    }
                }
                for b in images + eyes { CVPixelBufferUnlockBaseAddress(b, []) }
                let group = [
                    CMTaggedBuffer(tags: [.stereoView(.leftEye), .videoLayerID(0)], pixelBuffer: eyes[0]),
                    CMTaggedBuffer(tags: [.stereoView(.rightEye), .videoLayerID(1)], pixelBuffer: eyes[1]),
                ]
                while !input.isReadyForMoreMediaData { try await Task.sleep(nanoseconds: 2_000_000) }
                // (deprecated in macOS 26 in favour of TaggedPixelBufferGroupReceiver, still works)
                if !adaptor.appendTaggedBuffers(group, withPresentationTime: pts) {
                    throw writer.error ?? NSError(domain: "join", code: 2)
                }
                frames += 1
                // keep the audio roughly in step so the movie interleaves
                if let ai = audioIn, let ao = audioOut {
                    while ai.isReadyForMoreMediaData, let s = ao.copyNextSampleBuffer() {
                        ai.append(s)
                        if CMSampleBufferGetPresentationTimeStamp(s) > pts { break }
                    }
                }
                if frames % 30 == 0 {
                    print("frames \(frames)")
                    fflush(stdout)
                }
            }
            if let dir = segmentDir {
                for url in piece { try? fm.removeItem(at: url) }
                try? fm.removeItem(at: dir.appendingPathComponent(String(format: "%04d.ready", k)))
            }
            k += 1
        }
        guard writer != nil else { throw NSError(domain: "join", code: 4, userInfo: [NSLocalizedDescriptionKey: "no frames"]) }
        input.markAsFinished()
        if let ai = audioIn, let ao = audioOut {
            while let s = ao.copyNextSampleBuffer() {
                while !ai.isReadyForMoreMediaData { try await Task.sleep(nanoseconds: 2_000_000) }
                ai.append(s)
            }
            ai.markAsFinished()
        }
        await writer.finishWriting()
        audioReader?.cancelReading()
        if writer.status != .completed { throw writer.error ?? NSError(domain: "join", code: 3) }
        print("frames \(frames)")
        print("wrote \(outURL.path): \(eye)x\(eye) per eye, \(frames) frames, \(String(format: "%.1f", Date().timeIntervalSince(start))) s")
    } catch {
        print("error: \(error)")
        exit(1)
    }
    sem.signal()
}
sem.wait()
