import json
import os

from typing import List, Optional
from google.cloud import discoveryengine_v1 as discoveryengine
from google.api_core.client_options import ClientOptions
from dotenv import load_dotenv

load_dotenv()

PROJECT_ID = os.getenv("GCP_PROJECT_ID", "tier3-ops-resolver")
LOCATION = os.getenv("VERTEX_SEARCH_LOCATION", "global")
APP_ID = os.getenv("VERTEX_SEARCH_APP_ID", "ops-resolver-search_1770099767218")

def search_knowledge_base(query: str, filters: List[str] = [], limit: int = 5) -> str:
    """
    Vertex AI Search (App/Engine) を検索し、結果をテキストとして返す
    """
    try:
        client_options = (
            ClientOptions(api_endpoint=f"{LOCATION}-discoveryengine.googleapis.com")
            if LOCATION != "global" else None
        )
        
        client = discoveryengine.SearchServiceClient(client_options=client_options)
        
        serving_config = f"projects/{PROJECT_ID}/locations/{LOCATION}/collections/default_collection/engines/{APP_ID}/servingConfigs/default_search"

        filter_str = ""
        if filters:
            quoted_filters = [f'"{f}"' for f in filters]
            filter_str = f'knowledge_type: ANY({", ".join(quoted_filters)})'

        print(f"🔍 Searching App: '{query[:50]}...' Filter: {filter_str}")

        request = discoveryengine.SearchRequest(
            serving_config=serving_config,
            query=query,
            page_size=limit,
            filter=filter_str,
            content_search_spec=discoveryengine.SearchRequest.ContentSearchSpec(
                snippet_spec=discoveryengine.SearchRequest.ContentSearchSpec.SnippetSpec(
                    return_snippet=True
                )
            ),
        )
        
        response = client.search(request)
        
        context_text = ""
        for i, result in enumerate(response.results):
            data_obj = result.document.struct_data
            if not data_obj:
                data_obj = result.document.derived_struct_data
            
            try:
                data_dict = {}
                for key, value in data_obj.items():
                    data_dict[str(key)] = str(value) 
                
                content_str = json.dumps(data_dict, ensure_ascii=False, indent=2)
            except:
                content_str = str(data_obj)

            context_text += f"\n--- [参考資料 {i+1}] ---\n{content_str}\n"
            
        if not context_text:
            return "（関連するナレッジは見つかりませんでした）"
            
        return context_text

    except Exception as e:
        print(f"⚠️ Knowledge Search Error: {e}")
        return ""