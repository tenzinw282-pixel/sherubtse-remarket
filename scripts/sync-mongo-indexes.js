const mongoose = require('mongoose');
const {databaseFailure}=require('../config/databases');
const {logFailure}=require('../config/diagnostics');
require('dotenv').config({ quiet: true });
async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required');
  await mongoose.connect(process.env.MONGODB_URI, { autoIndex: false, serverSelectionTimeoutMS: 10000 });
  await createMongoIndexes();
  console.log('MongoDB indexes created');
}
async function createMongoIndexes(){
  const models=require('../models/documents');
  try{for(const model of Object.values(models))await model.createIndexes();}catch(error){throw databaseFailure('MongoDB',error);}
}
if(require.main===module)main().catch(error => { logFailure('mongodb-indexes',databaseFailure('MongoDB',error)); process.exitCode = 1; })
  .finally(() => mongoose.disconnect());
module.exports={createMongoIndexes};
