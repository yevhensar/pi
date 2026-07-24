let serialQueue: Promise<void> = Promise.resolve();
let serialReservations = 0;

export async function withFlightControllerSerial<T>(operation: () => Promise<T>): Promise<T> {
  const previous = serialQueue;
  let release = () => {};
  serialReservations += 1;
  serialQueue = new Promise<void>((resolve) => {
    release = resolve;
  });

  await previous;
  try {
    return await operation();
  } finally {
    serialReservations -= 1;
    release();
  }
}

export async function tryWithFlightControllerSerial<T>(
  operation: () => Promise<T>
): Promise<T> {
  if (serialReservations > 0) {
    throw new Error("Flight-controller serial port is busy; retry the command");
  }

  let release = () => {};
  serialReservations += 1;
  serialQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    return await operation();
  } finally {
    serialReservations -= 1;
    release();
  }
}
