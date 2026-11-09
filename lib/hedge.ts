// A hedged call, for a service whose answers are usually quick but sometimes very slow (Gemini: 3 to 6 s, now and
// then 26 s). make() is called once; if it has not answered after `after` ms, it is called a second time, and the
// first answer wins. A failure is not retried: it ends the call unless the other attempt is still running. After
// `limit` ms it gives up with the error "timeout". Whatever is still running is aborted when the call ends.
export const hedge = <T>(make: (signal: AbortSignal) => Promise<T>, after: number, limit: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const running: AbortController[] = [];
    let failed = 0, done = false;
    const end = (settle: () => void) => {
      if (done) return;
      done = true;
      clearTimeout(second);
      clearTimeout(give);
      running.forEach((c) => c.abort());
      settle();
    };
    const launch = () => {
      const c = new AbortController();
      running.push(c);
      make(c.signal).then((v) => end(() => resolve(v)), (e) => {
        failed += 1;
        if (failed === running.length) end(() => reject(e));
      });
    };
    const second = setTimeout(launch, after);
    const give = setTimeout(() => end(() => reject(new Error("timeout"))), limit);
    launch();
  });
