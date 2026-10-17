// Small real TIFF directory, wrapped by tests in the supported image containers.
export function captureExif(
  date = "2026:10:17 11:22:33",
  offset = "+01:00",
  fraction = "123",
) {
  const buffer = Buffer.alloc(96);
  buffer.write("II");
  buffer.writeUInt16LE(42, 2);
  buffer.writeUInt32LE(8, 4);
  buffer.writeUInt16LE(1, 8);
  buffer.writeUInt16LE(0x8769, 10);
  buffer.writeUInt16LE(4, 12);
  buffer.writeUInt32LE(1, 14);
  buffer.writeUInt32LE(26, 18);
  buffer.writeUInt16LE(3, 26);
  for (const [index, tag, value, pointer] of [
    [0, 0x9003, date, 68],
    [1, 0x9011, offset, 88],
    [2, 0x9291, fraction, null],
  ]) {
    const position = 28 + index * 12;
    buffer.writeUInt16LE(tag, position);
    buffer.writeUInt16LE(2, position + 2);
    buffer.writeUInt32LE(value.length + 1, position + 4);
    if (pointer !== null) {
      buffer.writeUInt32LE(pointer, position + 8);
      buffer.write(value, pointer);
    } else buffer.write(value, position + 8);
  }
  return buffer;
}

export function withCaptureExif(jpeg, date, offset, fraction) {
  const body = Buffer.concat([
    Buffer.from("Exif\0\0"),
    captureExif(date, offset, fraction),
  ]);
  const marker = Buffer.from([0xff, 0xe1, 0, 0]);
  marker.writeUInt16BE(body.length + 2, 2);
  return Buffer.concat([jpeg.subarray(0, 2), marker, body, jpeg.subarray(2)]);
}
