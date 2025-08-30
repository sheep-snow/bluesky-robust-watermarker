// Snowflake ID generator for unique post identification
export class SnowflakeGenerator {
  private static readonly EPOCH = 1640995200000; // 2022-01-01 00:00:00 UTC
  private static sequence = 0;
  private static lastTimestamp = -1;

  public static generate(): string {
    let timestamp = Date.now();

    if (timestamp < this.lastTimestamp) {
      throw new Error('Clock moved backwards');
    }

    if (timestamp === this.lastTimestamp) {
      this.sequence = (this.sequence + 1) & 0xfff;
      if (this.sequence === 0) {
        timestamp = this.waitNextMillis(this.lastTimestamp);
      }
    } else {
      this.sequence = 0;
    }

    this.lastTimestamp = timestamp;

    const timestampPart = (timestamp - this.EPOCH) << 22;
    const machineId = 1 << 17; // Simple machine ID
    const sequencePart = this.sequence;

    return (timestampPart | machineId | sequencePart).toString();
  }

  private static waitNextMillis(lastTimestamp: number): number {
    let timestamp = Date.now();
    while (timestamp <= lastTimestamp) {
      timestamp = Date.now();
    }
    return timestamp;
  }
}