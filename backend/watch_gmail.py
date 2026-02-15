import os

from dotenv import load_dotenv
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

load_dotenv()

TOPIC_NAME = os.getenv("PUBSUB_TOPIC_NAME", "projects/tier3-ops-resolver/topics/gmail-notifications")

def main():
    SCOPES = [
        'https://www.googleapis.com/auth/gmail.modify',
        'https://www.googleapis.com/auth/gmail.send',
        'https://www.googleapis.com/auth/pubsub'
    ]
    
    creds = Credentials.from_authorized_user_file('token.json', SCOPES)
    service = build('gmail', 'v1', credentials=creds)
    
    request = {
        'labelIds': ['INBOX'],
        'topicName': TOPIC_NAME
    }
    
    response = service.users().watch(userId='me', body=request).execute()
    print(f"👀 Watch started! History ID: {response.get('historyId')}")
    print(f"Expires: {response.get('expiration')}")

if __name__ == '__main__':
    main()