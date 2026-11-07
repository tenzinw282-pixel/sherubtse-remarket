const mongoose = require('mongoose');
require('dotenv').config({ quiet: true });
async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required');
  await mongoose.connect(process.env.MONGODB_URI, { autoIndex: false, serverSelectionTimeoutMS: 10000 });
  const models = require('../models/documents');
  for (const model of Object.values(models)) await model.createIndexes();
  console.log('MongoDB indexes created');
}
main().catch(error => { console.error('Index creation failed', { type: error.name }); process.exitCode = 1; })
  .finally(() => mongoose.disconnect());
