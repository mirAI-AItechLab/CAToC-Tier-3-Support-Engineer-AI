from google.cloud import firestore
db = firestore.Client(project="tier3-ops-resolver")
db.collection('system').document('gmail_state').delete()
print("✅ Gmail state reset.")