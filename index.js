const express = require('express');
const admin = require('firebase-admin');
const axios = require('axios');
const app = express();
app.use(express.json());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if(req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

const AISENSY_API_KEY = process.env.AISENSY_API_KEY;
const GOOGLE_REVIEW_LINK = process.env.GOOGLE_REVIEW_LINK || '';
const MANAGER_NAME = process.env.MANAGER_NAME || 'Management';

const STAFF_ALERT_NUMBER = '919605198999';
const OWNER_NUMBER = '918606097744';
const REPORT_NUMBER = '918606948606';

const TODAY = () => {
  const d = new Date();
  d.setHours(d.getHours() + 5, d.getMinutes() + 30);
  return d.toISOString().split('T')[0];
};

async function sendWhatsApp(phone, name, templateParams, campaignName) {
  try {
    const cleanPhone = String(phone).replace(/\D/g, '');
    const fullPhone = cleanPhone.startsWith('91') ? cleanPhone : '91' + cleanPhone;
    const res = await axios.post('https://backend.aisensy.com/campaign/t1/api/v2', {
      apiKey: AISENSY_API_KEY,
      campaignName: campaignName || 'survey_alert',
      destination: fullPhone,
      userName: name || 'Customer',
      templateParams: templateParams || [],
      media: {}
    });
    console.log(`✅ Sent to ${fullPhone}:`, res.data);
    return true;
  } catch(e) {
    console.error('Send error:', e.response?.data || e.message);
    return false;
  }
}

// BULK SEND SURVEY — software calls this
app.post('/send-survey', async (req, res) => {
  try {
    const { customers, templateName, campaignName } = req.body;
    if(!customers || !customers.length) return res.json({success: false, message: 'No customers'});

    const results = [];
    for(const c of customers) {
      const ok = await sendWhatsApp(c.phone, c.name, [c.name], campaignName || 'daily_survey');
      results.push({name: c.name, phone: c.phone, sent: ok});
      if(c.fireId) {
        try {
          await db.collection('customers').doc(c.fireId).update({surveySent: true});
        } catch(e) {}
      }
      await new Promise(r => setTimeout(r, 300));
    }

    const sent = results.filter(r => r.sent).length;
    res.json({success: true, sent, total: customers.length, results});
  } catch(e) {
    console.error('Send survey error:', e);
    res.json({success: false, message: e.message});
  }
});

// SEND REPORT
app.post('/send-report', async (req, res) => {
  try {
    const { reportText, phone } = req.body;
    const targetPhone = phone || REPORT_NUMBER;
    const ok = await sendWhatsApp(targetPhone, 'Accounts Manager', [reportText], 'weekly_report');
    res.json({success: ok});
  } catch(e) {
    res.json({success: false, message: e.message});
  }
});

// WEBHOOK — customer reply
app.post('/webhook', async (req, res) => {
  try {
    const body = req.body;
    console.log('Webhook:', JSON.stringify(body));

    const phone = body.waId || body.phone || body.mobile || body.data?.phone || '';
    const message = (body.text?.body || body.message || body.text || body.data?.message || body.button?.text || '').trim();

    if(!phone) return res.sendStatus(200);

    const cleanPhone = String(phone).replace(/\D/g, '').replace(/^91/, '');
    const snap = await db.collection('customers').where('date', '==', TODAY()).get();

    let customerDoc = null, customerId = null;
    snap.forEach(d => {
      const cp = String(d.data().phone).replace(/\D/g, '').replace(/^91/, '');
      if(cp === cleanPhone) { customerDoc = d; customerId = d.data().id; }
    });

    if(!customerDoc) return res.sendStatus(200);
    const cData = customerDoc.data();
    const msg = message.toLowerCase();

    let star = null;
    if(['നല്ലത്','good','5','4','satisfied'].some(x => msg.includes(x))) star = 5;
    else if(['ശരാശരി','average','3','ok'].some(x => msg.includes(x))) star = 3;
    else if(['മോശം','poor','bad','1','2'].some(x => msg.includes(x))) star = 1;
    else if(!isNaN(parseInt(message))) star = Math.min(5, Math.max(1, parseInt(message)));
    if(!star) return res.sendStatus(200);

    let issueType = null;
    if(msg.includes('staff') || msg.includes('behaviour')) issueType = 'Staff behaviour';
    else if(msg.includes('collection') || msg.includes('variety') || msg.includes('product')) issueType = 'Collection';
    else if(msg.includes('rate') || msg.includes('price')) issueType = 'Rate';

    const responseData = {
      customerId, name: cData.name, phone: cData.phone,
      salesPerson: cData.sales || '', star,
      issue: issueType || (star <= 3 ? 'Not specified' : null),
      apologySent: false, date: TODAY(),
      updatedAt: new Date().toISOString()
    };

    const existing = await db.collection('responses').where('customerId','==',customerId).where('date','==',TODAY()).get();
    if(existing.empty) await db.collection('responses').add(responseData);
    else await existing.docs[0].ref.update(responseData);
    await customerDoc.ref.update({surveySent: true});

    if(star >= 4) {
      const link = GOOGLE_REVIEW_LINK || '[Google Review Link]';
      await sendWhatsApp(cData.phone, cData.name,
        [`${cData.name}, നിങ്ങളുടെ positive feedback-ന് നന്ദി! 😊 Google Review ഇടാൻ: ${link} - Team Pathiyara ❤️`],
        'thank_you_message');
    } else {
      await sendWhatsApp(cData.phone, cData.name,
        [`${cData.name}, ക്ഷമിക്കണം 🙏 ${MANAGER_NAME} ഉടൻ ബന്ധപ്പെടും. - Pathiyara`],
        'apology_message');
      await customerDoc.ref.update({apologySent: true});

      if(!issueType || issueType === 'Staff behaviour') {
        await sendWhatsApp(STAFF_ALERT_NUMBER, 'Marketing Head',
          [`🚨 Staff Complaint!\nCustomer: ${cData.name}\nPhone: ${cData.phone}\nSales: ${cData.sales||'—'}\nIssue: ${issueType||'General'}`],
          'staff_alert');
      }
      if(issueType === 'Collection' || issueType === 'Rate') {
        await sendWhatsApp(OWNER_NUMBER, 'Purchase Manager',
          [`🚨 ${issueType} Complaint!\nCustomer: ${cData.name}\nPhone: ${cData.phone}\nSales: ${cData.sales||'—'}`],
          'owner_alert');
      }
    }

    res.sendStatus(200);
  } catch(e) {
    console.error('Webhook error:', e);
    res.sendStatus(500);
  }
});

// Weekly report
async function sendWeeklyReport() {
  try {
    const today = new Date();
    today.setHours(today.getHours() + 5, today.getMinutes() + 30);
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);
    const from = weekAgo.toISOString().split('T')[0];
    const to = today.toISOString().split('T')[0];

    const [cSnap, rSnap] = await Promise.all([
      db.collection('customers').where('date','>=',from).where('date','<=',to).get(),
      db.collection('responses').where('date','>=',from).where('date','<=',to).get()
    ]);

    const allC = [], allR = [];
    cSnap.forEach(d => allC.push(d.data()));
    rSnap.forEach(d => allR.push(d.data()));

    if(!allR.length) return;

    const total = allR.length;
    const satisfied = allR.filter(r => r.star >= 4).length;
    const staffData = {};
    allC.forEach(c => {
      const s = c.sales || 'Unknown';
      const r = allR.find(x => x.customerId === c.id);
      if(!staffData[s]) staffData[s] = {total:0, sum:0, complaints:0};
      if(r) { staffData[s].total++; staffData[s].sum += r.star; if(r.star<=3) staffData[s].complaints++; }
    });

    let staffReport = Object.entries(staffData).map(([n,d]) =>
      `• ${n} — ⭐${d.total?(d.sum/d.total).toFixed(1):0} (${d.total} customers, ${d.complaints} complaints)`
    ).join('\n');

    const report = `📊 *Pathiyara Weekly Report*\n${from} to ${to}\n\n👥 Responses: ${total}\n✅ Satisfied: ${satisfied} (${Math.round(satisfied/total*100)}%)\n😞 Not satisfied: ${total-satisfied}\n\n👨‍💼 *Staff Performance:*\n${staffReport}\n\n- Pathiyara Survey System`;

    await sendWhatsApp(REPORT_NUMBER, 'Accounts Manager', [report], 'weekly_report');
    console.log('✅ Weekly report sent');
  } catch(e) { console.error('Weekly report error:', e); }
}

setInterval(() => {
  const now = new Date();
  now.setHours(now.getHours() + 5, now.getMinutes() + 30);
  if(now.getDay() === 0 && now.getHours() === 20 && now.getMinutes() < 5) sendWeeklyReport();
}, 5 * 60 * 1000);

app.get('/send-report-now', async (req, res) => { await sendWeeklyReport(); res.send('Report sent ✅'); });
app.get('/', (req, res) => res.send('Pathiyara Survey Server Running ✅'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
