// O registro é gravado ANTES do clique: falha ou timeout nunca dispara reenvio.
const fs = require('fs');
async function submitOnce(button, confirmation, journal) {
  let handle;
  try { handle = fs.openSync(journal, 'wx'); }
  catch (error) { if(error.code === 'EEXIST') return 'submit_uncertain'; throw error; }
  fs.writeFileSync(handle, JSON.stringify({attemptedAt:new Date().toISOString(),status:'attempting'}));
  fs.closeSync(handle);
  try {
    await button.click();
    await confirmation.waitFor({state:'visible',timeout:15000});
    fs.writeFileSync(journal, JSON.stringify({confirmedAt:new Date().toISOString(),status:'submitted'}));
    return 'submitted';
  } catch {
    fs.writeFileSync(journal, JSON.stringify({updatedAt:new Date().toISOString(),status:'submit_uncertain'}));
    return 'submit_uncertain';
  }
}
module.exports = {submitOnce};
