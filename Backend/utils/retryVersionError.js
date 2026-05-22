// utils/retryVersionError.js — R7ap-F26/D7-05
//
// Tiny helper to wrap a save() block in a VersionError retry loop.
// Pre-R7ap many bill-mutation paths (voidPayment, bulkCollect, settlementAdjust,
// cancelBill, tpaApprove, tpaSettle) had no retry — concurrent writers would
// trip Mongoose's optimisticConcurrency __v guard and 500 the request.
//
// Usage:
//   const bill = await retryVersionError(async () => {
//     const b = await PatientBill.findById(id);
//     ...mutate...
//     await b.save();
//     return b;
//   });
module.exports = async function retryVersionError(work, { maxRetries = 5, label = "save" } = {}) {
  let lastErr;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await work(attempt);
    } catch (err) {
      if (err?.name === "VersionError") {
        lastErr = err;
        // Tiny jitter so two concurrent writers don't ping-pong forever.
        await new Promise((r) => setTimeout(r, 20 + Math.random() * 50));
        continue;
      }
      throw err;
    }
  }
  const e = new Error(
    `[${label}] VersionError after ${maxRetries} retries: ${lastErr?.message || "unknown"}`,
  );
  e.code = "VERSION_RETRY_EXHAUSTED";
  throw e;
};
