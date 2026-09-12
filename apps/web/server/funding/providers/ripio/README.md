# Ripio funding adapter

Reference adapter for AR wARS and CO wCOP. It uses raw HTTP through the bounded provider context, one country-specific credential pair per binding, a shared webhook verification secret, quotes, email-based customer creation, terms acceptance, optional KYC fields, order creation, polling, and webhook verification.

All automated coverage uses synthetic responses and test doubles. No live provider call or funded flow was run for #301. Before enabling a binding, Ripio must confirm the current API schema, terms/KYC fields, country catalog, and production webhook header against operator credentials.
