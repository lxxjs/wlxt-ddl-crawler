"""
Data models for courses and homework.
"""
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Optional

# 网络学堂 shows every time in Beijing time (UTC+8, no DST). Deadlines are
# stored timezone-aware so they stay correct when this runs elsewhere.
BEIJING_TZ = timezone(timedelta(hours=8), "CST")


def _now_like(deadline: datetime) -> datetime:
    """Current time, comparable with `deadline` (aware or naive)."""
    return datetime.now(deadline.tzinfo)


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
            return _now_like(self.deadline) > self.deadline
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

        now = _now_like(self.deadline)
        if now > self.deadline:
            return 0

        hours_left = (self.deadline - now).total_seconds() / 3600
        if hours_left < 24:
            return 1
        elif hours_left < 72:
            return 2
        elif hours_left < 168:
            return 3
        else:
            return 4
