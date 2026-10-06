.PHONY: install test lint format eval eval-llm serve docker

install:
	pip install -e ".[dev,ollama]"

test:
	pytest

lint:
	ruff check .
	ruff format --check .
	cfn-lint template.yaml

format:
	ruff check --fix .
	ruff format .

eval:
	python -m evals.run

eval-llm:
	RA_ENGINE=llm python -m evals.run

serve:
	uvicorn recruiter_agent.api:app --reload

docker:
	docker build -t recruiter-agent .
	docker run --rm -p 8000:8000 recruiter-agent
