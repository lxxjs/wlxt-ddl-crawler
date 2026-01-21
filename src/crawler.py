"""
Crawler module for fetching courses and homework from 网络学堂.
"""
from datetime import datetime
from typing import List, Optional
import requests

from .config import (
    SEMESTER_LIST_URL,
    COURSE_LIST_URL,
    HOMEWORK_LIST_URL,
    HOMEWORK_SUBMITTED_URL,
    BASE_URL,
)
from .models import Course, Homework


class HomeworkCrawler:
    """
    Fetches courses and homework assignments from 网络学堂 APIs.
    """
    
    def __init__(self, session: requests.Session):
        self.session = session
    
    def get_current_semester(self) -> str:
        """Get the current semester ID."""
        try:
            response = self.session.get(SEMESTER_LIST_URL)
            response.raise_for_status()
            data = response.json()
            
            if data.get('result') == 'success' and data.get('resultList'):
                # First item is usually the current semester
                return data['resultList'][0]['id']
        except Exception as e:
            print(f"⚠️ Failed to get semester list: {e}")
        
        # Fallback: calculate current semester
        return self._calculate_current_semester()
    
    def _calculate_current_semester(self) -> str:
        """Calculate current semester ID based on date."""
        now = datetime.now()
        year = now.year
        month = now.month
        
        # Spring semester: Feb-Jun (semester 2)
        # Summer semester: Jul-Aug (semester 3)  
        # Fall semester: Sep-Jan (semester 1)
        if 2 <= month <= 6:
            return f"{year - 1}-{year}-2"
        elif 7 <= month <= 8:
            return f"{year - 1}-{year}-3"
        elif month >= 9:
            return f"{year}-{year + 1}-1"
        else:  # Jan
            return f"{year - 1}-{year}-1"
    
    def get_courses(self, semester_id: Optional[str] = None) -> List[Course]:
        """
        Fetch list of enrolled courses for the semester.
        
        Args:
            semester_id: Semester ID (e.g., "2024-2025-1"). 
                        If None, uses current semester.
        
        Returns:
            List of Course objects
        """
        if semester_id is None:
            semester_id = self.get_current_semester()
        
        print(f"📚 Fetching courses for semester: {semester_id}")
        
        try:
            # Use form data for POST request
            response = self.session.post(
                COURSE_LIST_URL,
                data={'semester': semester_id},
                headers={'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'}
            )
            response.raise_for_status()
            data = response.json()
            
            courses = []
            if data.get('result') == 'success' and data.get('resultList'):
                for item in data['resultList']:
                    course = Course(
                        id=item.get('wlkcid', ''),
                        name=item.get('kcm', 'Unknown Course'),
                        teacher=item.get('jsm', ''),
                        semester=semester_id,
                        course_number=item.get('kch', ''),
                    )
                    courses.append(course)
            
            print(f"   Found {len(courses)} courses")
            return courses
            
        except requests.exceptions.HTTPError as e:
            print(f"❌ Failed to fetch courses (HTTP {e.response.status_code}): {e}")
            # Debug: Print response content
            if e.response:
                print(f"   Response: {e.response.text[:200]}...")
            return []
        except Exception as e:
            print(f"❌ Failed to fetch courses: {e}")
            return []
    
    def get_homework(self, course: Course) -> List[Homework]:
        """
        Fetch homework assignments for a specific course.
        
        Args:
            course: Course object
        
        Returns:
            List of Homework objects
        """
        homework_list = []
        
        # Fetch unsubmitted homework
        homework_list.extend(
            self._fetch_homework_list(course, HOMEWORK_LIST_URL, "unsubmitted")
        )
        
        return homework_list
    
    def _fetch_homework_list(
        self, 
        course: Course, 
        url: str, 
        status: str
    ) -> List[Homework]:
        """Fetch homework from a specific API endpoint."""
        try:
            response = self.session.post(
                url,
                data={
                    'wlkcid': course.id,
                    'size': 100,  # Get up to 100 items
                    'page': 1,
                },
                headers={'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'}
            )
            response.raise_for_status()
            data = response.json()
            
            homework_list = []
            
            # Handle the nested object structure
            result_data = data.get('object', {})
            if isinstance(result_data, dict):
                rows = result_data.get('aaData', [])
            else:
                rows = []
            
            for item in rows:
                deadline_str = item.get('jzsj', '')
                deadline = self._parse_deadline(deadline_str)
                
                # Calculate time left
                time_left = ""
                if deadline:
                    diff = deadline - datetime.now()
                    if diff.total_seconds() < 0:
                        time_left = "已过期"
                    elif diff.days > 0:
                        time_left = f"{diff.days}天"
                    else:
                        hours = int(diff.total_seconds() // 3600)
                        time_left = f"{hours}小时"
                
                hw = Homework(
                    id=item.get('zyid', ''),
                    title=item.get('bt', 'Untitled'),
                    course_name=course.name,
                    course_id=course.id,
                    deadline=deadline,
                    deadline_str=deadline_str,
                    status=status,
                    time_left=time_left,
                    description=item.get('sm', ''),
                )
                homework_list.append(hw)
            
            return homework_list
            
        except Exception as e:
            print(f"   ⚠️ Failed to fetch {status} homework for {course.name}: {e}")
            return []
    
    def _parse_deadline(self, deadline_str: str) -> Optional[datetime]:
        """Parse deadline string into datetime object."""
        if not deadline_str:
            return None
        
        # Try common date formats
        formats = [
            "%Y-%m-%d %H:%M:%S",
            "%Y-%m-%d %H:%M",
            "%Y-%m-%d",
        ]
        
        for fmt in formats:
            try:
                return datetime.strptime(deadline_str, fmt)
            except ValueError:
                continue
        
        return None
    
    def get_all_homework(self, semester_id: Optional[str] = None) -> List[Homework]:
        """
        Fetch all homework from all courses in a semester.
        
        Args:
            semester_id: Semester ID. If None, uses current semester.
        
        Returns:
            List of all Homework objects, sorted by deadline
        """
        courses = self.get_courses(semester_id)
        all_homework = []
        
        print("📝 Fetching homework from each course...")
        for course in courses:
            print(f"   → {course.name}")
            homework = self.get_homework(course)
            all_homework.extend(homework)
        
        # Sort by deadline (None/expired at the end)
        all_homework.sort(
            key=lambda h: (h.deadline is None, h.is_expired, h.deadline or datetime.max)
        )
        
        print(f"\n✅ Found {len(all_homework)} homework assignments total")
        return all_homework
