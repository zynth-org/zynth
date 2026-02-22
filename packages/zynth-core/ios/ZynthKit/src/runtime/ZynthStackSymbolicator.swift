import Foundation

@objc(ZynthStackSymbolicator)
public final class ZynthStackSymbolicator: NSObject {
  private static let logTag = "[ZynthSymbolicator]"
  private struct StackFrame {
    let file: String
    let method: String
    let lineNumber: Int
    let column: Int?
  }

  private struct ParsedLocation {
    let file: String
    let lineNumber: Int?
    let column: Int?
  }

  private struct Segment {
    let generatedColumn: Int
    let sourceIndex: Int?
    let originalLine: Int?
    let originalColumn: Int?
    let nameIndex: Int?
  }

  private struct SourceMapIndex {
    let sources: [String]
    let names: [String]
    let sourceRoot: String?
    let lines: [[Segment]]
  }

  private struct OriginalPosition {
    let source: String?
    let line: Int?
    let column: Int?
    let name: String?
  }

  private static let queue = DispatchQueue(label: "com.zynth.stackSymbolicator")
  private static let lock = NSLock()
  private static var mapCache: [String: SourceMapIndex?] = [:]

  @objc(symbolicate:completion:)
  public static func symbolicate(_ stack: String, completion: @escaping (NSString) -> Void) {
    queue.async {
      let frames = parseStack(stack)
      if frames.isEmpty {
        print("\(logTag) no frames parsed")
        DispatchQueue.main.async { completion(stack as NSString) }
        return
      }
      print("\(logTag) parsed \(frames.count) frames")

      let group = DispatchGroup()
      var outputs = Array(repeating: "", count: frames.count)

      for (index, frame) in frames.enumerated() {
        guard let bundleURL = normalizedBundleURL(for: frame.file) else {
          print("\(logTag) skipping non-symbolic frame: \(frame.file)")
          outputs[index] = formatFrame(method: frame.method, source: frame.file, line: frame.lineNumber, column: frame.column)
          continue
        }

        group.enter()
        symbolicate(frame: frame, bundleURL: bundleURL) { line in
          outputs[index] = line
          group.leave()
        }
      }

      group.notify(queue: queue) {
        let combined = outputs.joined(separator: "\n")
        DispatchQueue.main.async {
          completion(combined as NSString)
        }
      }
    }
  }

  private static func symbolicate(frame: StackFrame, bundleURL: String, completion: @escaping (String) -> Void) {
    fetchMapIndex(bundleURL: bundleURL) { index in
      guard let index else {
        print("\(logTag) no sourcemap for \(bundleURL)")
        completion(formatFrame(method: frame.method, source: frame.file, line: frame.lineNumber, column: frame.column))
        return
      }

      var original = resolveOriginalPosition(index: index, frame: frame)
      if original.source == nil {
        original = findClosestMapping(index: index, frame: frame)
      }

      if let source = original.source {
        let method = original.name ?? frame.method
        print("\(logTag) symbolicated \(frame.file):\(frame.lineNumber)")
        completion(formatFrame(method: method, source: source, line: original.line, column: original.column))
      } else {
        print("\(logTag) mapping not found for \(frame.file):\(frame.lineNumber)")
        completion(formatFrame(method: frame.method, source: frame.file, line: frame.lineNumber, column: frame.column))
      }
    }
  }

  private static func parseStack(_ stack: String) -> [StackFrame] {
    let lines = stack.split(separator: "\n", omittingEmptySubsequences: false)
    var frames: [StackFrame] = []
    for line in lines {
      let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
      guard trimmed.hasPrefix("at ") else { continue }
      let body = String(trimmed.dropFirst(3)).trimmingCharacters(in: .whitespacesAndNewlines)
      if body.isEmpty { continue }

      var method = "<unknown>"
      var location = body

      if let parenStart = body.range(of: " ("),
         body.hasSuffix(")") {
        let m = body[..<parenStart.lowerBound].trimmingCharacters(in: .whitespacesAndNewlines)
        method = m.isEmpty ? "<unknown>" : m
        location = String(body[parenStart.upperBound..<body.index(before: body.endIndex)]).trimmingCharacters(in: .whitespacesAndNewlines)
      }

      let parsed = parseLocation(location)
      guard let lineNumber = parsed.lineNumber else { continue }
      frames.append(StackFrame(file: parsed.file, method: method, lineNumber: lineNumber, column: parsed.column))
    }
    return frames
  }

  private static func parseLocation(_ location: String) -> ParsedLocation {
    var loc = location.trimmingCharacters(in: .whitespacesAndNewlines)
    if loc.hasSuffix(")") {
      loc.removeLast()
    }
    guard let regex = try? NSRegularExpression(pattern: ":(\\d+)(?::(\\d+))?$"),
          let match = regex.firstMatch(in: loc, options: [], range: NSRange(loc.startIndex..., in: loc)),
          let fileRange = Range(NSRange(location: 0, length: match.range.location), in: loc),
          let lineRange = Range(match.range(at: 1), in: loc)
    else {
      return ParsedLocation(file: loc, lineNumber: nil, column: nil)
    }
    let file = String(loc[fileRange])
    let line = Int(loc[lineRange])
    var col: Int?
    if match.numberOfRanges > 2,
       match.range(at: 2).location != NSNotFound,
       let colRange = Range(match.range(at: 2), in: loc) {
      col = Int(loc[colRange])
    }
    return ParsedLocation(file: file, lineNumber: line, column: col)
  }

  private static func fetchMapIndex(bundleURL: String, completion: @escaping (SourceMapIndex?) -> Void) {
    guard let mapURL = mapURLFor(bundleURL: bundleURL) else {
      print("\(logTag) invalid bundle URL: \(bundleURL)")
      completion(nil)
      return
    }
    lock.lock()
    if mapCache.keys.contains(mapURL.absoluteString) {
      let cached = mapCache[mapURL.absoluteString] ?? nil
      lock.unlock()
      completion(cached)
      return
    }
    lock.unlock()

    var request = URLRequest(url: mapURL)
    request.timeoutInterval = 2.0
    request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
    request.setValue("application/json", forHTTPHeaderField: "Accept")

    URLSession.shared.dataTask(with: request) { data, response, _ in
      guard let http = response as? HTTPURLResponse,
            (200...299).contains(http.statusCode),
            let data,
            let json = String(data: data, encoding: .utf8)
      else {
        let status = (response as? HTTPURLResponse)?.statusCode ?? -1
        print("\(logTag) sourcemap fetch failed (\(status)) \(mapURL.absoluteString)")
        lock.lock()
        mapCache[mapURL.absoluteString] = nil
        lock.unlock()
        completion(nil)
        return
      }
      print("\(logTag) sourcemap fetched \(mapURL.absoluteString)")
      let parsed = parseSourceMap(json)
      if parsed == nil {
        print("\(logTag) sourcemap parse failed \(mapURL.absoluteString)")
      }
      lock.lock()
      mapCache[mapURL.absoluteString] = parsed
      lock.unlock()
      completion(parsed)
    }.resume()
  }

  private static func normalizedBundleURL(for file: String) -> String? {
    if file.hasPrefix("http://") || file.hasPrefix("https://") {
      return file
    }
    guard let baseURL = currentDevServerURL() else {
      return nil
    }
    let trimmed = file.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    guard !trimmed.isEmpty else { return nil }
    return baseURL.appendingPathComponent(trimmed).absoluteString
  }

  private static func currentDevServerURL() -> URL? {
    let env = ProcessInfo.processInfo.environment
    if let envValue = env["ZYNTH_DEV_SERVER_URL"]?.trimmingCharacters(in: .whitespacesAndNewlines),
       !envValue.isEmpty,
       let url = URL(string: envValue) {
      return url
    }
    if let plist = Bundle.main.object(forInfoDictionaryKey: "ZynthDevServerURL") as? String {
      let value = plist.trimmingCharacters(in: .whitespacesAndNewlines)
      if !value.isEmpty {
        return URL(string: value)
      }
    }
    return nil
  }

  private static func mapURLFor(bundleURL: String) -> URL? {
    guard var components = URLComponents(string: bundleURL) else { return nil }
    components.path = components.path + ".map"
    return components.url
  }

  private static func parseSourceMap(_ json: String) -> SourceMapIndex? {
    guard let data = json.data(using: .utf8),
          let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let mappings = object["mappings"] as? String,
          !mappings.isEmpty
    else { return nil }

    let sources = (object["sources"] as? [String]) ?? []
    let names = (object["names"] as? [String]) ?? []
    let sourceRoot = (object["sourceRoot"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
    let lines = parseMappings(mappings)
    if lines.isEmpty { return nil }
    return SourceMapIndex(
      sources: sources,
      names: names,
      sourceRoot: sourceRoot?.isEmpty == true ? nil : sourceRoot,
      lines: lines
    )
  }

  private static func parseMappings(_ mappings: String) -> [[Segment]] {
    var lines: [[Segment]] = []
    var previousSource = 0
    var previousOriginalLine = 0
    var previousOriginalColumn = 0
    var previousName = 0

    for lineChunk in mappings.split(separator: ";", omittingEmptySubsequences: false) {
      var previousGeneratedColumn = 0
      var segments: [Segment] = []
      for raw in lineChunk.split(separator: ",", omittingEmptySubsequences: true) {
        let values = decodeVlq(String(raw))
        if values.isEmpty { continue }
        let generatedColumn = previousGeneratedColumn + values[0]
        previousGeneratedColumn = generatedColumn
        if values.count >= 4 {
          let sourceIndex = previousSource + values[1]
          previousSource = sourceIndex
          let originalLine = previousOriginalLine + values[2]
          previousOriginalLine = originalLine
          let originalColumn = previousOriginalColumn + values[3]
          previousOriginalColumn = originalColumn
          var nameIndex: Int?
          if values.count >= 5 {
            nameIndex = previousName + values[4]
            previousName = nameIndex ?? previousName
          }
          segments.append(
            Segment(
              generatedColumn: generatedColumn,
              sourceIndex: sourceIndex,
              originalLine: originalLine,
              originalColumn: originalColumn,
              nameIndex: nameIndex
            )
          )
        } else {
          segments.append(
            Segment(
              generatedColumn: generatedColumn,
              sourceIndex: nil,
              originalLine: nil,
              originalColumn: nil,
              nameIndex: nil
            )
          )
        }
      }
      lines.append(segments)
    }
    return lines
  }

  private static func decodeVlq(_ segment: String) -> [Int] {
    var values: [Int] = []
    var chars = Array(segment)
    var index = 0
    while index < chars.count {
      var shift = 0
      var result = 0
      var continuation = false
      repeat {
        if index >= chars.count { return values }
        let digit = fromBase64(chars[index])
        if digit < 0 { return values }
        index += 1
        continuation = (digit & 32) != 0
        let valueBits = digit & 31
        result += valueBits << shift
        shift += 5
      } while continuation
      let isNegative = (result & 1) == 1
      let decoded = result >> 1
      values.append(isNegative ? -decoded : decoded)
    }
    return values
  }

  private static func fromBase64(_ c: Character) -> Int {
    guard let scalar = c.unicodeScalars.first?.value else { return -1 }
    switch scalar {
    case 65...90: return Int(scalar - 65)
    case 97...122: return 26 + Int(scalar - 97)
    case 48...57: return 52 + Int(scalar - 48)
    case 43: return 62
    case 47: return 63
    default: return -1
    }
  }

  private static func resolveOriginalPosition(index: SourceMapIndex, frame: StackFrame) -> OriginalPosition {
    let line = frame.lineNumber
    let colInput = frame.column ?? 1
    let colZero = max(0, colInput - 1)
    let candidates = [
      lookupPosition(index: index, generatedLine: line, generatedColumn: colZero, greatestLowerBound: true),
      lookupPosition(index: index, generatedLine: line, generatedColumn: colInput, greatestLowerBound: true),
      lookupPosition(index: index, generatedLine: line, generatedColumn: colZero, greatestLowerBound: false),
      lookupPosition(index: index, generatedLine: line, generatedColumn: colInput, greatestLowerBound: false),
    ]
    for item in candidates where item.source != nil {
      return item
    }
    return OriginalPosition(source: nil, line: nil, column: nil, name: nil)
  }

  private static func findClosestMapping(index: SourceMapIndex, frame: StackFrame) -> OriginalPosition {
    guard frame.lineNumber - 1 >= 0, frame.lineNumber - 1 < index.lines.count else {
      return OriginalPosition(source: nil, line: nil, column: nil, name: nil)
    }
    let segments = index.lines[frame.lineNumber - 1]
    if segments.isEmpty {
      return OriginalPosition(source: nil, line: nil, column: nil, name: nil)
    }
    let targetColumn = frame.column ?? 0
    var bestSegment: Segment?
    var bestDelta = Int.max
    for segment in segments {
      guard let sourceIndex = segment.sourceIndex,
            sourceIndex >= 0,
            sourceIndex < index.sources.count
      else { continue }
      let delta = abs(segment.generatedColumn - targetColumn)
      if delta < bestDelta {
        bestDelta = delta
        bestSegment = segment
      }
    }
    return segmentToOriginal(index: index, segment: bestSegment)
  }

  private static func lookupPosition(
    index: SourceMapIndex,
    generatedLine: Int,
    generatedColumn: Int,
    greatestLowerBound: Bool
  ) -> OriginalPosition {
    guard generatedLine - 1 >= 0, generatedLine - 1 < index.lines.count else {
      return OriginalPosition(source: nil, line: nil, column: nil, name: nil)
    }
    let segments = index.lines[generatedLine - 1]
    if segments.isEmpty {
      return OriginalPosition(source: nil, line: nil, column: nil, name: nil)
    }
    let chosen: Segment?
    if greatestLowerBound {
      chosen = segments.last(where: { $0.generatedColumn <= generatedColumn })
    } else {
      chosen = segments.first(where: { $0.generatedColumn >= generatedColumn })
    }
    return segmentToOriginal(index: index, segment: chosen)
  }

  private static func segmentToOriginal(index: SourceMapIndex, segment: Segment?) -> OriginalPosition {
    guard let segment,
          let sourceIndex = segment.sourceIndex,
          sourceIndex >= 0,
          sourceIndex < index.sources.count
    else {
      return OriginalPosition(source: nil, line: nil, column: nil, name: nil)
    }
    let source = resolveSource(sourceRoot: index.sourceRoot, source: index.sources[sourceIndex])
    let name: String?
    if let nameIndex = segment.nameIndex,
       nameIndex >= 0,
       nameIndex < index.names.count {
      name = index.names[nameIndex]
    } else {
      name = nil
    }
    return OriginalPosition(
      source: source,
      line: segment.originalLine.map { $0 + 1 },
      column: segment.originalColumn,
      name: name
    )
  }

  private static func resolveSource(sourceRoot: String?, source: String) -> String {
    guard let sourceRoot, !sourceRoot.isEmpty else { return source }
    if source.hasPrefix("/") || source.contains("://") { return source }
    return sourceRoot.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/" + source.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
  }

  private static func formatFrame(method: String, source: String?, line: Int?, column: Int?) -> String {
    let safeSource = source ?? "<unknown>"
    let safeLine = line.map(String.init) ?? "null"
    let safeColumn = column.map(String.init) ?? "null"
    return "at \(method) (\(safeSource):\(safeLine):\(safeColumn))"
  }
}
