"""Service layer for Flasky Notes.

Services own DB writes and the unit-of-work boundary (one commit per operation).
Routes call services; models hold data + read accessors only. This keeps
business logic out of both routes (which should just parse input + format
output) and models (which should only describe rows + read accessors).
"""