"use strict";
// Compatibility tombstone: elevated JavaScript component updating was withdrawn
// after antivirus blocked it. Do not recreate tasks or restore quarantined files.
module.exports = Object.freeze({
  configured: () => false,
  needsActivation: () => false,
  state: () => null,
  activate: async () => {}
});
