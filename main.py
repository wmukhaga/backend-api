from fastapi import FastAPI
from pydantic import BaseModel
import uuid

app=FastAPI()
events =[]

@app.get("/health")
def health_check():
    return{"status":"TikoSorted API is runnning"}

class EventCreate(BaseModel):
    name: str
    venue: str
    capacity: int
@app.post("/events")
def create_event(event: EventCreate):
 event_id=str(uuid.uuid4())
 new_event={
      "id": event_id,
        "name": event.name,
        "venue": event.venue,
        "capacity": event.capacity,
        "status": "DRAFT"
 }
 events.append(new_event)
 return new_event
@app.get("/events/{event_id}")
def get_events(event_id:str):
    for event in events:
        if event["id"]==event_id:
            return event
        return{"error":"Event not found"}
@app.patch("/events/{event_id}")
def patch_events(event_id:str, updates :EventUpdate):
    for event in events:
     if event["id"] == event_id:
        return event
    return{"error"}



        