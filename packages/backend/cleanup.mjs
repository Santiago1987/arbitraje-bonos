import mongoose from 'mongoose';
await mongoose.connect('mongodb://localhost:27017/arbitraje-bonos');
const ex = await mongoose.connection.db.collection('exercises').deleteOne({ _id: new mongoose.Types.ObjectId('69f91cf14e7d43f9aa925e17') });
const ops = await mongoose.connection.db.collection('arbitrage_operations').deleteMany({ exerciseId: '69f91cf14e7d43f9aa925e17' });
console.log('exercises deleted:', ex.deletedCount, '; operations deleted:', ops.deletedCount);
await mongoose.disconnect();
