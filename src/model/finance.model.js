const mongoose = require('mongoose');

const financeSchema = new mongoose.Schema(
  {
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Student',
      required: true,
    }
  }
)


module.exports = mongoose.model('Finance', financeSchema);