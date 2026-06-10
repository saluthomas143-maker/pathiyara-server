 }
    await customerDoc.ref.update({ surveySent: true });
 
    // Send appropriate message & alerts
    if (star >= 4) {
      await sendWhatsApp(cData.phone, thankMsg(cData.name));
    } else {
      await sendWhatsApp(cData.phone, apologyMsg(cData.name, issueType || 'experience'));
      await customerDoc.ref.update({ apologySent: true });
 
      // Instant alerts
      if (issueType === 'Staff' || !issueType) {
        await sendWhatsApp(STAFF_ALERT_NUMBER, staffAlertMsg(cData.name, cData.sales || 'Unknown', cData.phone));
      }
      if (issueType === 'Collection' || issueType === 'Rate') {
        await sendWhatsApp(OWNER_NUMBER, collectionAlertMsg(cData.name, issueType, cData.phone));
      }
      if (!issueType) {
        await sendWhatsApp(OWNER_NUMBER, collectionAlertMsg(cData.name, 'General complaint', cData.phone));
      }
    }
 
    console.log(`✅ Saved: ${cData.name} - ${star} stars`);
    res.sendStatus(200);
  } catch (e) {
    console.error('Webhook error:', e);
    res.sendStatus(500);
  }
});
 
// Manual weekly report trigger
app.get('/send-report', async (req, res) => {
  await sendWeeklyReport();
  res.send('Report sent ✅');
});
 
app.get('/', (req, res) => res.send('Pathiyara Survey Server Running ✅'));
 
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
