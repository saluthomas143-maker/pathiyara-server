const express = require('express');
const admin = require('firebase-admin');
const axios = require('axios');
const app = express();
app.use(express.json());

// Firebase init
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

const AISENSY_API_KEY = process.env.AISENSY_API_KEY;
const GOOGLE_REVIEW_LINK = process.env.GOOGLE_REVIEW_LINK || '';
const MANAGER_NAME = process.env.MANAGER_NAME || 'Management';

const TODAY = () => {
  const d = new Date();
  d.setHours(d.getHours() + 5, d.getMinutes() + 30); // IST
  return d.toISOString().split('T')[0];
};

// Send WhatsApp message via AiSensy
async function sendWhatsApp(phone, message) {
  try {
    const cleanPhone = String(phone).replace(/\D/g, '');
    const fullPhone = cleanPhone.startsWith('91') ? cleanPhone : '91' + cleanPhone;
    await axios.post('https://backend.aisensy.com/campaign/t1/api/v2', {
      apiKey: AISENSY_API_KEY,
      campaignName: 'survey_response',
      destination: fullPhone,
      userName: 'Pathiyara Tiles',
      templateParams: [message],
      media: {}
    });
    console.log(`✅ Message sent to ${fullPhone}`);
  } catch (e) {
    console.error('Send error:', e.response?.data || e.message);
  }
}

// Messages
function thankMsg(name) {
  return `${name}, നിങ്ങളുടെ positive feedback-ന് വളരെ സന്തോഷം! 😊🙏\n\nGoogle-ൽ ഒരു review ഇട്ടാൽ മറ്റുള്ളവർക്ക് helpful ആകും.\n👇\n${GOOGLE_REVIEW_LINK}\n\n*Team Pathiyara Tiles & Sanitaryware* ❤️`;
}

function apologyMsg(name, issue) {
  return `നമസ്കാരം ${name},\n\n${MANAGER_NAME} സംസാരിക്കുന്നു.\n\n"${issue || 'experience'}" സംബന്ധിച്ച് അറിയിച്ചത് ഞങ്ങൾ ഗൗരവമായി കാണുന്നു. 🙏\n\nഅസൗകര്യത്തിൽ ആത്മാർത്ഥമായി ക്ഷമ ചോദിക്കുന്നു. ഒരു അവസരം കൂടി തന്നാൽ മികച്ച service ഉറപ്പ് തരാം.\n\n– ${MANAGER_NAME}\nPathiyara Tiles & Sanitaryware`;
}

// AiSensy Webhook
app.post('/webhook', async (req, res) => {
  try {
    const body = req.body;
    console.log('Webhook:', JSON.stringify(body));

    // AiSensy webhook format
    const phone = body.waId || body.phone || body.mobile || 
                  body.data?.phone || body.contact?.phone || '';
    const message = (body.text?.body || body.message || body.text || 
                     body.data?.message || body.button?.text || '').trim();
    const name = body.pushName || body.name || body.contact?.name || '';

    if (!phone) return res.sendStatus(200);

    console.log(`Phone: ${phone}, Message: ${message}, Name: ${name}`);

    // Find customer by phone
    const cleanPhone = String(phone).replace(/\D/g, '').replace(/^91/, '');
    const snap = await db.collection('customers')
      .where('date', '==', TODAY())
      .get();

    let customerDoc = null;
    let customerId = null;
    snap.forEach(d => {
      const cp = String(d.data().phone).replace(/\D/g, '').replace(/^91/, '');
      if (cp === cleanPhone) { 
        customerDoc = d; 
        customerId = d.data().id; 
      }
    });

    if (!customerDoc) {
      console.log('Customer not found for phone:', cleanPhone);
      return res.sendStatus(200);
    }

    const cData = customerDoc.data();

    // Parse button response or number
    let star = null;
    const msg = message.toLowerCase();
    if (['നല്ലത്', 'good', '5', '4', 'satisfied', 'happy'].some(x => msg.includes(x))) star = 5;
    else if (['ശരാശരി', 'average', '3', 'ok', 'okay'].some(x => msg.includes(x))) star = 3;
    else if (['മോശം', 'poor', 'bad', '1', '2', 'not satisfied', 'unhappy'].some(x => msg.includes(x))) star = 1;
    else if (!isNaN(parseInt(message))) star = Math.min(5, Math.max(1, parseInt(message)));

    if (!star) return res.sendStatus(200);

    // Check existing response
    const existing = await db.collection('responses')
      .where('customerId', '==', customerId)
      .where('date', '==', TODAY())
      .get();

    const responseData = {
      customerId,
      name: cData.name,
      phone: cData.phone,
      star,
      issue: star <= 3 ? 'Reported via WhatsApp' : null,
      apologySent: false,
      date: TODAY(),
      updatedAt: new Date().toISOString()
    };

    if (existing.empty) {
      await db.collection('responses').add(responseData);
    } else {
      await existing.docs[0].ref.update(responseData);
    }

    await customerDoc.ref.update({ surveySent: true });
    console.log(`✅ Saved: ${cData.name} - ${star} stars`);

    // Auto send next message
    if (star >= 4) {
      await sendWhatsApp(cData.phone, thankMsg(cData.name));
    } else {
      await sendWhatsApp(cData.phone, apologyMsg(cData.name, 'experience'));
      await customerDoc.ref.update({ apologySent: true });
      await existing.empty 
        ? db.collection('responses').where('customerId','==',customerId).get().then(s => s.docs[0]?.ref.update({ apologySent: true }))
        : existing.docs[0].ref.update({ apologySent: true });
    }

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
