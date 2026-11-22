export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

export class FakeClock implements Clock {
  private currentTime: Date;

  constructor(initialTime: Date | string | number = new Date()) {
    this.currentTime = new Date(initialTime);
  }

  now(): Date {
    return new Date(this.currentTime);
  }

  set(time: Date | string | number): void {
    this.currentTime = new Date(time);
  }

  advanceMinutes(minutes: number): void {
    this.currentTime = new Date(this.currentTime.getTime() + minutes * 60 * 1000);
  }

  advanceHours(hours: number): void {
    this.advanceMinutes(hours * 60);
  }

  advanceDays(days: number): void {
    this.advanceHours(days * 24);
  }
}

