"""
Data models for courses and homework.
"""
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional


@dataclass
class Course:
    """Represents a course in 网络学堂."""
    id: str
    name: str
    teacher: str = ""
    semester: str = ""
    course_number: str = ""

    def __str__(self) -> str:
        return f"{self.name} ({self.teacher})"


@dataclass
class Homework:
    """Represents a homework assignment."""
    id: str
    title: str
    course_name: str
    course_id: str
    deadline: Optional[datetime] = None
    deadline_str: str = ""
    status: str = "unsubmitted"  # unsubmitted, submitted, expired
    time_left: str = ""
    description: str = ""
    
    def __str__(self) -> str:
        return f"[{self.course_name}] {self.title} - Due: {self.deadline_str}"
    
    @property
    def is_expired(self) -> bool:
        """Check if homework deadline has passed."""
        if self.deadline:
            return datetime.now() > self.deadline
        return False
    
    @property
    def urgency_level(self) -> int:
        """
        Return urgency level for sorting (lower = more urgent).
        0 = expired
        1 = due within 24 hours
        2 = due within 3 days
        3 = due within 7 days
        4 = due later
        5 = no deadline set
        """
        if not self.deadline:
            return 5  # No deadline - lowest priority
        
        if self.is_expired:
            return 0
        
        time_diff = self.deadline - datetime.now()
        hours_left = time_diff.total_seconds() / 3600
        
        if hours_left < 24:
            return 1
        elif hours_left < 72:
            return 2
        elif hours_left < 168:
            return 3
        else:
            return 4
