// The audio tracks of a movie as AVFoundation reads them (scripts/spatial-check.mjs --movie):
// codec, channels, channel layout, enabled, alternate group, duration.
//   swift scripts/spatial-info.swift exports/visionpro/x.mov
import AVFoundation

let url = URL(fileURLWithPath: CommandLine.arguments[1])
let sem = DispatchSemaphore(value: 0)
Task {
    do {
        let asset = AVURLAsset(url: url)
        for track in try await asset.loadTracks(withMediaType: .video) {
            let f = try await track.load(.formatDescriptions).first!
            let size = try await track.load(.naturalSize)
            print("video track \(track.trackID): \(fourcc(CMFormatDescriptionGetMediaSubType(f))) \(Int(size.width))x\(Int(size.height)) per eye")
        }
        for track in try await asset.loadTracks(withMediaType: .audio) {
            let f = try await track.load(.formatDescriptions).first!
            let enabled = try await track.load(.isEnabled)
            let range = try await track.load(.timeRange)
            let groups = try await asset.load(.trackGroups).filter { $0.trackIDs.contains(NSNumber(value: track.trackID)) }.map { $0.trackIDs.map(\.intValue) }
            let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(f)!.pointee
            var size = 0
            let layout = CMAudioFormatDescriptionGetChannelLayout(f, sizeOut: &size)
            var tag = "none"
            if let l = layout {
                let t = l.pointee.mChannelLayoutTag
                tag = (t >> 16) == 190 ? "HOA ACN/SN3D, \(t & 0xffff) ch" : String(format: "0x%08x", t)
            }
            let rate = try await track.load(.estimatedDataRate)
            print("audio track \(track.trackID): \(fourcc(CMFormatDescriptionGetMediaSubType(f))) \(asbd.mChannelsPerFrame) ch \(Int(asbd.mSampleRate)) Hz, layout \(tag), \(Int(rate / 1000)) kbps, \(String(format: "%.2f", range.duration.seconds)) s, enabled \(enabled), alternate group \(groups)")
        }
    } catch {
        print("error: \(error)")
    }
    sem.signal()
}
sem.wait()

func fourcc(_ c: FourCharCode) -> String {
    String(bytes: [24, 16, 8, 0].map { UInt8((c >> $0) & 0xff) }, encoding: .ascii) ?? "\(c)"
}
