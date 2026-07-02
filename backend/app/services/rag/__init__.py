"""RAG assistant: one retrieval backbone (pgvector) with three skills on top.

- candidate_search        semantic + filtered search over candidate embeddings
- matching_explanation    grounded explanation of a stored score_breakdown
- policy_qa               classic RAG over ingested policy document chunks
"""
