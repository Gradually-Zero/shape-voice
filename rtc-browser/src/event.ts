export interface Disposable {
  dispose(): void;
}

interface Event<T> {
  (listener: (event: T) => unknown): Disposable;
}

interface EmitterOptions {
  onListenerError?: (error: unknown) => void;
}

export class Emitter<T> implements Disposable {
  private readonly listeners = new Set<(event: T) => unknown>();
  private readonly onListenerError: (error: unknown) => void;
  private disposed = false;

  public readonly event: Event<T> = (listener) => {
    if (this.disposed) {
      return { dispose: () => undefined };
    }

    this.listeners.add(listener);
    let subscribed = true;

    return {
      dispose: () => {
        if (!subscribed) {
          return;
        }
        subscribed = false;
        this.listeners.delete(listener);
      },
    };
  };

  constructor(options: EmitterOptions = {}) {
    this.onListenerError =
      options.onListenerError ??
      ((error) => {
        queueMicrotask(() => {
          throw error;
        });
      });
  }

  public fire(event: T): void {
    if (this.disposed) {
      return;
    }

    const listeners = [...this.listeners];
    for (const listener of listeners) {
      if (!this.listeners.has(listener)) {
        continue;
      }
      try {
        listener(event);
      } catch (error) {
        this.onListenerError(error);
      }
    }
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.listeners.clear();
  }
}
