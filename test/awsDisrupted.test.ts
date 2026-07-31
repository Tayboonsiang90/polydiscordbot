import { describe, expect, it } from "vitest";
import {
  extractAwsDisruptedEventValue,
  getDisruptedAwsEvents,
  type AwsHistoryEventsResponse
} from "../src/integrations/awsDisrupted.js";

const noDisruptedResponse: AwsHistoryEventsResponse = {
  "ec2-us-east-1": [
    {
      arn: "arn:normal",
      date: "1770040800",
      region_name: "N. Virginia",
      service: "ec2-us-east-1",
      service_name: "Amazon Elastic Compute Cloud",
      summary: "Increased API Error Rates",
      status: "2",
      event_log: [{ status: "2", timestamp: 1770040800 }]
    }
  ]
};

const disruptedResponse: AwsHistoryEventsResponse = {
  "s3-us-east-1": [
    {
      arn: "arn:older-disrupted",
      date: "1770040800",
      region_name: "N. Virginia",
      service: "s3-us-east-1",
      service_name: "Amazon Simple Storage Service",
      summary: "Older Disrupted Event",
      status: "3",
      event_log: [{ status: "3", timestamp: 1770040800 }]
    }
  ],
  "lambda-us-east-1": [
    {
      arn: "arn:newer-disrupted",
      date: "1770200000",
      region_name: "N. Virginia",
      service: "lambda-us-east-1",
      service_name: "AWS Lambda",
      summary: "Newer Disrupted Event",
      status: "1",
      event_log: [{ status: "3", timestamp: 1770200300 }]
    }
  ]
};

describe("AWS disrupted events adapter", () => {
  it("returns a stable no-disrupted value when no qualifying events exist", () => {
    expect(extractAwsDisruptedEventValue(noDisruptedResponse)).toBe(
      "No disrupted AWS service interruption events found"
    );
  });

  it("formats disrupted events as a monitor value", () => {
    const value = extractAwsDisruptedEventValue(disruptedResponse);

    expect(value).toContain("AWS DISRUPTED EVENT DETECTED");
    expect(value).toContain("Event 1: Newer Disrupted Event");
    expect(value).toContain("Service: AWS Lambda");
    expect(value).toContain("Severity: disrupted");
    expect(value).toContain("ARN: arn:newer-disrupted");
  });

  it("sorts disrupted events newest first", () => {
    expect(getDisruptedAwsEvents(disruptedResponse).map((event) => event.arn)).toEqual([
      "arn:newer-disrupted",
      "arn:older-disrupted"
    ]);
  });

  it("keeps monitoring disrupted events after the original June market window", () => {
    const response: AwsHistoryEventsResponse = {
      "ec2-us-east-1": [
        {
          arn: "arn:post-june-disrupted",
          date: String(Date.parse("2026-07-15T12:00:00.000Z") / 1000),
          summary: "Post-June Disrupted Event",
          status: "3"
        }
      ]
    };

    expect(getDisruptedAwsEvents(response).map((event) => event.arn)).toEqual(["arn:post-june-disrupted"]);
  });
});
