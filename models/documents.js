const mongoose = require('mongoose');
const { Schema } = mongoose;
const reference = { type: String, required: true, match: /^[0-9a-f-]{36}$/i };

const conversationSchema = new Schema({
  productId: reference,
  participantIds: { type: [String], required: true, validate: values =>
    values.length === 2 && new Set(values).size === 2 && values.every(v => /^[0-9a-f-]{36}$/i.test(v)) },
  // Set from productId and sorted participants in the messaging service.
  conversationKey: { type: String, required: true, unique: true },
  lastMessageAt: Date,
  readAt: { type: Map, of: Date }
}, { timestamps: true });
conversationSchema.index({ participantIds: 1, lastMessageAt: -1 });
const messageSchema = new Schema({
  conversationId: { type: Schema.Types.ObjectId, ref: 'Conversation', required: true },
  senderId: reference,
  body: { type: String, required: true, maxlength: 4000, trim: true }
}, { timestamps: true });
messageSchema.index({ conversationId: 1, createdAt: -1, _id: -1 });
const notificationSchema = new Schema({
  userId: reference,
  eventKey: { type: String, required: true },
  type: { type: String, required: true },
  text: { type: String, required: true, maxlength: 1000 },
  link: { type: String, validate: value => /^\/(?!\/)/.test(value) },
  readAt: Date
}, { timestamps: true });
notificationSchema.index({ userId: 1, eventKey: 1 }, { unique: true });
notificationSchema.index({ userId: 1, readAt: 1, createdAt: -1 });
const activitySchema = new Schema({
  userId: String, action: { type: String, required: true },
  targetId: String, metadata: { type: Map, of: String }
}, { timestamps: true });
activitySchema.index({ userId: 1, createdAt: -1 });
module.exports = {
  Conversation: mongoose.model('Conversation', conversationSchema),
  Message: mongoose.model('Message', messageSchema),
  Notification: mongoose.model('Notification', notificationSchema),
  ActivityLog: mongoose.model('ActivityLog', activitySchema)
};
