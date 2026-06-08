const express = require('express');
const admin = require('firebase-admin');
const app = express();
app.use(express.json());

// Firebase init
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

const TODAY = () => new Date().toISOString().split('T')[0];

// AiSensy Webhook
app.post('/webhook', async (req, res) => {
  try {
    const body = req.body;
    console.log('Webhook received:', JSON.stringify(body));

    const phone = body.phone || body.mobile || body.waId || '';
    const message = (body.message || body.text || body.reply || '').trim();
    const name = body.name || body.contactName || '';

    if (!phone || !message) return res.sendStatus(200);

    // Find customer by phone
    const cleanPhone = phone.replace(/\D/g, '').replace(/^91/, '');
    const snap = await db.collection('customers')
      .where('date', '==', TODAY())
      .get();

    let customerDoc = null;
    let customerId = null;
    snap.forEach(d => {
      const cp = String(d.data().phone).replace(/\D/g, '').replace(/^91/, '');
      if (cp === cleanPhone) { customerDoc = d; customerId = d.data().id; }
    });

    if (!customerDoc) return res.sendStatus(200);

    const cData = customerDoc.data();

    // Parse response — customer sends 1-5 or നല്ലത്/മോശം
    let star = null;
    if (['5', '4', 'നല്ലത്', 'good', 'great'].includes(message.toLowerCase())) star = 5;
    else if (['3', 'ശരാശരി', 'average', 'ok'].includes(message.toLowerCase())) star = 3;
    else if (['1', '2', 'മോശം', 'poor', 'bad'].includes(message.toLowerCase())) star = 1;
    else if (!isNaN(parseInt(message))) star = parseInt(message);

    if (!star) return res.sendStatus(200);

    // Save response to Firebase
    const existing = await db.collection('responses')
      .where('customerId', '==', customerId)
      .where('date', '==', TODAY())
      .get();

    const responseData = {
      customerId,
      name: cData.name,
      phone: cData.phone,
      star,
      date: TODAY(),
      apologySent: false,
      updatedAt: new Date().toISOString()
    };

    if (existing.empty) {
      await db.collection('responses').add(responseData);
    } else {
      await existing.docs[0].ref.update(responseData);
    }

    // Update customer surveySent
    await customerDoc.ref.update({ surveySent: true });

    console.log(`✅ Response saved: ${cData.name} - ${star} stars`);
    res.sendStatus(200);
  } catch (e) {
    console.error('Webhook error:', e);
    res.sendStatus(500);
  }
});

// Health check
app.get('/', (req, res) => res.send('Pathiyara Survey Server Running ✅'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
