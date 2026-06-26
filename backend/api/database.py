import json
from datetime import datetime
from pathlib import Path
from sqlalchemy import create_engine, Column, Integer, String, DateTime, Text, ForeignKey
from sqlalchemy.orm import declarative_base, sessionmaker, relationship

Base = declarative_base()

class Project(Base):
    __tablename__ = 'projects'

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(255), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    status = Column(String(50), default="Created")
    
    # Relationships
    jobs = relationship("Job", back_populates="project", cascade="all, delete-orphan")

class Job(Base):
    __tablename__ = 'jobs'

    id = Column(String(50), primary_key=True)  # uuid string
    project_id = Column(Integer, ForeignKey('projects.id'), nullable=False)
    job_type = Column(String(50), nullable=False)  # 'alignment' or 'ffs'
    status = Column(String(50), default="queued")  # queued, running, completed, failed
    params = Column(Text, default="{}")  # JSON string of params
    result_path = Column(String(500), nullable=True)  # Path to saved file if any
    created_at = Column(DateTime, default=datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)

    project = relationship("Project", back_populates="jobs")

    def get_params(self):
        return json.loads(self.params) if self.params else {}

    def set_params(self, params_dict):
        self.params = json.dumps(params_dict)


def init_db():
    db_path = Path(__file__).parent.parent.parent / "database.sqlite"
    engine = create_engine(f"sqlite:///{db_path}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    return engine, SessionLocal

engine, SessionLocal = init_db()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
