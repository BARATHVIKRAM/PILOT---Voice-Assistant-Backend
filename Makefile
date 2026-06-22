.PHONY: install dev lint test clean

install:
	cd backend && pip install -r requirements.txt
	cd frontend && npm install

dev:
	cp -n backend/.env.example backend/.env 2>/dev/null || true
	mkdir -p backend/data
	cd backend && .venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000 --reload --reload-exclude "uploads" --reload-exclude "data"

frontend-dev:
	cd frontend && npm run dev

lint:
	cd backend && ruff check . --fix
	cd frontend && npx tsc --noEmit

test:
	cd backend && pytest tests/ -v --asyncio-mode=auto

clean:
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
	find . -name "*.pyc" -delete 2>/dev/null || true
	rm -f backend/data/pilot.db backend/data/test.db
