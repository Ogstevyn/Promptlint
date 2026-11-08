from openai import OpenAI

client = OpenAI()

def answer_support_query(user_query: str, retrieved_docs: str):
    response = client.chat.completions.create(
        model="gpt-4-turbo",
        messages=[
            {
                "role": "user",
                "content": f"""User Question: {user_query}

Please could you kindly use the following enterprise documentation to answer the user question above. You are a very helpful, polite, and intelligent AI assistant that always tries your best to summarize in one sentence. Thank you so much in advance for your help!

Documentation Context:
{retrieved_docs}"""
            }
        ]
    )
    return response.choices[0].message.content
